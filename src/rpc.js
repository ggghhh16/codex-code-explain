'use strict';
const { EventEmitter } = require('node:events');
const { spawn } = require('node:child_process');
const { createInterface } = require('node:readline');

class RpcClient extends EventEmitter {
  constructor(executable, options = {}) {
    super();
    this.pending = new Map();
    this.nextId = 1;
    this.closed = false;
    this.child = (options.spawn || spawn)(executable, options.args || ['app-server', '--listen', 'stdio://'], {
      cwd: options.cwd, windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'], env: options.env || process.env
    });
    this.child.on('error', error => this.fail(new Error(`无法启动 Codex：${error.message}`)));
    this.child.on('exit', (code) => this.fail(new Error(`Codex 进程已退出（${code ?? '终止'}）。请重新打开讲解。`)));
    this.child.stdin.on('error', error => this.fail(error));
    // Do not log stderr: upstream diagnostics can contain paths or sensitive context.
    this.child.stderr.on('data', () => {});
    this.lines = createInterface({ input: this.child.stdout });
    this.lines.on('line', line => {
      let message;
      try { message = JSON.parse(line); } catch { return; }
      if (message.id !== undefined && message.method) {
        // This read-only explainer never grants tool, command, or file approvals.
        const result = message.method.endsWith('requestApproval') ? { decision: 'decline' } : undefined;
        this.send(result ? { id: message.id, result } : { id: message.id, error: { code: -32601, message: '本插件仅支持代码讲解，不提供工具执行或交互授权。' } });
      } else if (message.id !== undefined) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.error) pending.reject(new Error(message.error.message || 'Codex 请求失败'));
        else pending.resolve(message.result);
      } else if (message.method) this.emit('notification', message.method, message.params || {});
    });
  }
  send(message) {
    if (this.closed) return;
    this.child.stdin.write(JSON.stringify(message) + '\n');
  }
  request(method, params = {}, timeout = 30000) {
    if (this.closed) return Promise.reject(new Error('Codex 连接已关闭。'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Codex 请求超时：${method}`)); }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.send({ id, method, params });
    });
  }
  async initialize() {
    await this.request('initialize', { clientInfo: { name: 'codex_code_explain', title: 'Codex 代码讲解', version: require('../package.json').version }, capabilities: { experimentalApi: true } });
    this.send({ method: 'initialized', params: {} });
  }
  fail(error) {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear();
    this.emit('closed', error);
  }
  dispose() { this.fail(new Error('会话已关闭。')); this.lines.close(); this.child.kill(); }
}

module.exports = { RpcClient };
