'use strict';
const { RpcClient } = require('./rpc');
const { instructions } = require('./prompts');

function supportsFast(model) {
  return (model.serviceTiers || []).some(t => t.id === 'fast') || (model.additionalSpeedTiers || []).includes('fast');
}
function validateSettings(models, settings) {
  const model = models.find(m => m.model === settings.model);
  if (!model) throw new Error('Choose an available model returned by Codex.');
  if (!model.supportedReasoningEfforts.some(e => e.reasoningEffort === settings.effort)) throw new Error('This model does not support the selected reasoning effort.');
  if (settings.fast && !supportsFast(model)) throw new Error('This model does not advertise fast mode.');
  return { model: model.model, effort: settings.effort, fast: !!settings.fast };
}

class CodexSession {
  constructor(executable, cwd, options = {}) {
    const args = ['app-server', '--listen', 'stdio://',
      '-c', `permissions.codex-explain.filesystem={ ":minimal" = "read", ${JSON.stringify(cwd)} = "read" }`,
      '-c', 'permissions.codex-explain.network.enabled=false',
      '-c', 'features.hooks=false', '-c', 'features.apps=false', '-c', 'features.plugins=false',
      '-c', 'features.shell_tool=false', '-c', 'features.unified_exec=false'];
    this.rpc = new RpcClient(executable, { cwd, args, ...options });
    this.cwd = cwd;
    this.active = null;
    this.models = [];
    this.rpc.on('notification', (method, params) => this.onNotification(method, params));
    this.rpc.on('closed', error => this.finish(error));
  }
  async connect(saved = {}) {
    await this.rpc.initialize();
    let cursor;
    do {
      const result = await this.rpc.request('model/list', { limit: 100, includeHidden: false, ...(cursor ? { cursor } : {}) });
      this.models.push(...result.data);
      cursor = result.nextCursor;
    } while (cursor);
    if (!this.models.length) throw new Error('Codex returned no available models. Run codex login first.');
    const model = this.models.find(m => m.model === saved.model) || this.models.find(m => m.isDefault) || this.models[0];
    this.settings = validateSettings(this.models, {
      model: model.model,
      effort: model.supportedReasoningEfforts.some(e => e.reasoningEffort === saved.effort) ? saved.effort : model.defaultReasoningEffort,
      fast: !!saved.fast && supportsFast(model)
    });
    // Disable inherited integrations explicitly, without displaying or persisting config values.
    const configuration = await this.rpc.request('config/read', { includeLayers: false });
    const config = configuration.config || {};
    // App Server config overrides are dotted TOML paths, not nested JSON tables.
    this.threadConfig = {
      'features.shell_tool': false, 'features.unified_exec': false,
      'features.apps': false, 'features.plugins': false, 'features.hooks': false,
      'features.memories': false, 'features.multi_agent': false, 'features.code_mode': false,
      web_search: 'disabled', project_doc_max_bytes: 0,
      ...Object.fromEntries(Object.keys(config.plugins || {}).map(key => [`plugins.${key}.enabled`, false])),
      ...Object.fromEntries(Object.keys(config.mcp_servers || {}).map(key => [`mcp_servers.${key}.enabled`, false])),
      ...Object.fromEntries(['_default', ...Object.keys(config.apps || {})].map(key => [`apps.${key}.enabled`, false]))
    };
    return { models: this.models, settings: this.settings };
  }
  async createThread() {
    const result = await this.rpc.request('thread/start', {
      cwd: this.cwd, model: this.settings.model, serviceTier: this.settings.fast ? 'fast' : 'default',
      permissions: 'codex-explain', approvalPolicy: 'never', ephemeral: true,
      config: this.threadConfig, baseInstructions: instructions,
      developerInstructions: 'Explain only the code material in the user message. Do not call any tools.',
      environments: []
    }, 60000);
    return result.thread.id;
  }
  async run(text, onText, { fresh = false } = {}) {
    if (this.active) throw new Error('Wait for the current answer to finish or stop it first.');
    const active = { onText, items: new Map(), turnId: null, cancelled: false };
    this.active = active;
    const completion = new Promise((resolve, reject) => { active.resolve = resolve; active.reject = reject; });
    // The caller may still be awaiting thread/start; attach a handler immediately.
    completion.catch(() => {});
    active.timer = setTimeout(() => { this.finish(new Error('The answer exceeded five minutes and the connection was closed. Close and reopen the explanation.')); this.rpc.dispose(); }, 300000);
    try {
      active.threadId = fresh ? await this.createThread() : (this.threadId || (this.threadId = await this.createThread()));
      if (active.cancelled) { this.finish(new Error('Stopped.')); return await completion; }
      const result = await this.rpc.request('turn/start', {
        threadId: active.threadId,
        input: [{ type: 'text', text, text_elements: [] }],
        model: this.settings.model, effort: this.settings.effort,
        serviceTier: this.settings.fast ? 'fast' : 'default',
        approvalPolicy: 'never', permissions: 'codex-explain',
        environments: []
      }, 60000);
      active.turnId = result.turn.id;
      if (active.cancelled && this.active === active) await this.cancel();
    } catch (error) {
      if (this.active === active) this.finish(error);
      if (error.message.includes('request timed out')) this.rpc.dispose();
    }
    return completion;
  }
  onNotification(method, params) {
    const active = this.active;
    if (!active || params.threadId !== active.threadId) return;
    if (params.turnId && active.turnId && params.turnId !== active.turnId) return;
    if (method === 'turn/started') active.turnId = params.turn.id;
    if (method === 'item/agentMessage/delta') {
      active.items.set(params.itemId, (active.items.get(params.itemId) || '') + params.delta);
      active.onText([...active.items.values()].join('\n\n'));
    }
    if (method === 'item/completed' && params.item?.type === 'agentMessage') {
      active.items.set(params.item.id, params.item.text);
      active.onText([...active.items.values()].join('\n\n'));
    }
    if (method === 'turn/completed') {
      if (active.turnId && params.turn.id !== active.turnId) return;
      if (params.turn.status === 'failed') this.finish(new Error(params.turn.error?.message || 'Codex failed to answer.'));
      else if (params.turn.status === 'interrupted' || active.cancelled) this.finish(new Error('Stopped.'));
      else this.finish();
    }
  }
  finish(error) {
    const active = this.active;
    if (!active) return;
    this.active = null;
    clearTimeout(active.timer);
    const text = [...active.items.values()].join('\n\n');
    if (error) active.reject(error);
    else if (!text.trim()) active.reject(new Error('Codex returned no explanation.'));
    else active.resolve(text);
  }
  async cancel() {
    const active = this.active;
    if (!active) return;
    active.cancelled = true;
    if (active.threadId && active.turnId) await this.rpc.request('turn/interrupt', { threadId: active.threadId, turnId: active.turnId });
  }
  dispose() { this.rpc.dispose(); }
}

module.exports = { CodexSession, supportsFast, validateSettings };
