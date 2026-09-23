'use strict';
const vscode = require('vscode');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { CodexSession, supportsFast, validateSettings } = require('./codex');
const { resolveCodex } = require('./resolve-codex');
const { collectContext, redact } = require('./context');
const { initialPrompt, followupPrompt, notePrompt } = require('./prompts');
const { appendNote, noteId } = require('./notes');
const { safeMarkdown, commandLink, quoteChoices, completedMessages } = require('./hover-content');

const actions = ['ask', 'quote', 'save', 'options', 'stop', 'retry', 'forget'].map(name => `codexExplain.hover.${name}`);
function activate(extensionContext) {
  const records = new Map();
  const collecting = new Set();
  let disposed = false;
  const valid = record => record && !record.disposed && records.get(record.id) === record;
  function forget(record) {
    if (!record) return;
    record.disposed = true;
    record.session?.dispose();
    records.delete(record.id);
  }
  function eligible(record) {
    const editor = vscode.window.activeTextEditor;
    return valid(record) && editor?.document.uri.toString() === record.uri.toString()
      && editor.document.version === record.version && record.range.contains(editor.selection.active);
  }
  async function reveal(record, explicit = false) {
    if (!eligible(record)) return;
    await vscode.commands.executeCommand('editor.action.hideHover');
    if (eligible(record)) await vscode.commands.executeCommand('editor.action.showHover', { focus: explicit ? 'autoFocusImmediately' : 'noAutoFocus' });
  }
  function hoverFor(record) {
    const title = new vscode.MarkdownString();
    title.appendMarkdown('### Codex 代码讲解\n\n');
    const model = record.session?.settings;
    title.appendText(`${path.basename(record.uri.fsPath)} · L${record.range.start.line + 1}–${record.range.end.line + 1}${model ? ` · ${model.model} / ${model.effort}${model.fast ? ' / 快速' : ''}` : ''}`);
    const body = new vscode.MarkdownString();
    body.isTrusted = false;
    body.supportHtml = false;
    for (const [index, message] of record.messages.entries()) {
      if (message.role === 'user') {
        if (index > 0) body.appendMarkdown(`\n\n---\n\n**追问**\n\n${safeMarkdown(message.text)}\n\n`);
      } else if (message.text) {
        body.appendMarkdown(`${safeMarkdown(message.text)}\n\n`);
        if (!message.complete) body.appendMarkdown(message.interrupted ? '*此回答未完成。*\n\n' : '*正在生成…*\n\n');
      }
    }
    if (record.status) body.appendMarkdown(`\n\n*${safeMarkdown(record.status)}*`);
    if (record.error) body.appendMarkdown(`\n\n**${safeMarkdown(record.error)}**`);
    const bar = new vscode.MarkdownString('', true);
    bar.isTrusted = { enabledCommands: actions };
    const link = (label, action) => commandLink(label, `codexExplain.hover.${action}`, record.id);
    const links = record.busy ? [link('$(debug-stop) 停止', 'stop')] : [link('$(comment-discussion) 追问', 'ask'), link('$(quote) 引用片段追问', 'quote'), link('$(bookmark) 保存笔记', 'save'), link('$(settings-gear) 设置', 'options')];
    if (record.lastRequest && !record.busy) links.push(link('$(refresh) 重试', 'retry'));
    if (!record.busy) links.push(link('$(close) 清除本次讲解', 'forget'));
    bar.appendMarkdown(links.join('　'));
    return new vscode.Hover([title, bar, body], record.range);
  }
  extensionContext.subscriptions.push(vscode.languages.registerHoverProvider([{ scheme: 'file' }, { scheme: 'untitled' }, { scheme: 'vscode-remote' }], {
    provideHover(document, position) {
      if (collecting.has(document.uri.toString())) return undefined;
      const record = [...records.values()].reverse().find(r => r.uri.toString() === document.uri.toString() && r.version === document.version && r.range.contains(position));
      return record ? hoverFor(record) : undefined;
    }
  }));

  async function connect(record) {
    if (record.session && !record.session.rpc.closed && record.connected) return;
    record.session?.dispose();
    record.connected = false;
    const executable = resolveCodex(vscode.workspace.getConfiguration('codexExplain', record.uri).get('codexPath'), vscode.extensions.all);
    const cwd = path.join(extensionContext.globalStorageUri.fsPath, 'sessions');
    await fs.mkdir(cwd, { recursive: true });
    if (!valid(record)) return;
    record.session = new CodexSession(executable, cwd);
    await record.session.connect(extensionContext.globalState.get('modelSettings', {}));
    record.connected = true;
  }
  async function answer(record, prompt, label) {
    if (!valid(record) || record.busy) return;
    record.busy = true;
    record.error = '';
    record.status = 'Codex 正在讲解；完成后在这里显示。';
    record.lastRequest = { prompt, label };
    const response = { role: 'assistant', text: '', complete: false };
    record.messages.push({ role: 'user', text: label, complete: true }, response);
    await reveal(record);
    try {
      await connect(record);
      if (!valid(record)) return;
      if (record.cancelRequested) throw new Error('已停止。');
      const input = !record.session.threadId && record.messages.length > 2
        ? `${initialPrompt(record.source)}\n\n此前已完成的对话（数据）：\n${JSON.stringify(completedMessages(record.messages))}\n\n当前问题：${prompt}` : prompt;
      response.text = await record.session.run(input, text => { if (valid(record)) response.text = text; });
      response.complete = true;
      record.lastRequest = null;
    } catch (error) { response.interrupted = true; record.error = redact(error.message); }
    finally {
      record.busy = false;
      record.cancelRequested = false;
      record.status = '';
      if (valid(record)) {
        await reveal(record);
        if (!eligible(record) && !record.error) vscode.window.setStatusBarMessage('Codex 讲解已完成，悬停原选区即可查看。', 7000);
      }
    }
  }
  async function explain() {
    if (!vscode.workspace.isTrusted) throw new Error('请先信任当前工作区。');
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.selection.isEmpty) throw new Error('请先框选需要解释的代码。');
    const uri = editor.document.uri;
    const range = new vscode.Range(editor.selection.start, editor.selection.end);
    const version = editor.document.version;
    // Preserve highlighted text; put active cursor at its start so native Hover stays by the selection.
    editor.selection = new vscode.Selection(range.end, range.start);
    for (const record of records.values()) if (record.uri.toString() === uri.toString() && record.range.isEqual(range)) forget(record);
    while (records.size >= 8) {
      const idle = [...records.values()].find(record => !record.busy);
      if (!idle) throw new Error('已有 8 个讲解正在运行，请先停止一个。');
      forget(idle);
    }
    const record = { id: randomUUID(), uri, range, version, messages: [], busy: true, status: '正在读取选区附近的定义和类型…' };
    records.set(record.id, record);
    await reveal(record, true);
    collecting.add(uri.toString());
    try {
      record.source = await collectContext(vscode, { document: editor.document, selection: new vscode.Selection(range.start, range.end) }, vscode.workspace.getConfiguration('codexExplain', uri));
      if (!valid(record) || editor.document.version !== version) { forget(record); return; }
    } catch (error) { forget(record); throw error; }
    finally { collecting.delete(uri.toString()); record.busy = false; }
    await answer(record, initialPrompt(record.source), '解释选区的来源、结构和用法');
  }
  async function ask(record, withQuote = false) {
    if (record.busy) return;
    let quote = '';
    if (withQuote) {
      const choices = quoteChoices(record.messages);
      if (!choices.length) throw new Error('讲解完成后才能选择引用片段。');
      const choice = await vscode.window.showQuickPick(choices, { title: '选择要追问的讲解片段', placeHolder: '可输入关键词筛选', matchOnDetail: true });
      if (!choice || !valid(record)) { await reveal(record, true); return; }
      quote = choice.quote;
    }
    const text = await vscode.window.showInputBox({ title: withQuote ? '引用片段追问 · Codex' : '追问 · Codex', prompt: quote ? quote.slice(0, 220) : '继续解释当前选区，不改变源代码', placeHolder: '例如：这个参数是谁传进来的？', ignoreFocusOut: true, validateInput: text => text.length > 8000 ? '请将追问限制在 8000 字符以内。' : undefined });
    if (!text?.trim() || !valid(record)) { await reveal(record, true); return; }
    const question = redact(text.trim());
    await answer(record, followupPrompt(question, quote), quote ? `引用：${quote}\n\n${question}` : question);
  }
  async function options(record) {
    if (record.busy || !record.connected) return;
    const session = record.session;
    const selection = await vscode.window.showQuickPick([
      { label: '$(symbol-misc) 模型', key: 'model', description: session.settings.model },
      { label: '$(settings) 思考强度', key: 'effort', description: session.settings.effort },
      { label: '$(zap) 快速模式', key: 'fast', description: session.settings.fast ? '已开启' : '已关闭' },
      { label: '$(notebook) 笔记路径', key: 'notes' }
    ], { title: 'Codex 讲解设置', placeHolder: '修改后对下一次提问生效' });
    if (!selection || !valid(record)) { await reveal(record, true); return; }
    const next = { ...session.settings };
    if (selection.key === 'notes') { await vscode.commands.executeCommand('codexExplain.settings'); return; }
    if (selection.key === 'model') {
      const picked = await vscode.window.showQuickPick(session.models.map(model => ({ label: model.displayName || model.model, description: model.model, model })), { title: '选择模型' });
      if (picked) { next.model = picked.model.model; next.effort = picked.model.defaultReasoningEffort; next.fast = next.fast && supportsFast(picked.model); }
    } else if (selection.key === 'effort') {
      const model = session.models.find(m => m.model === next.model);
      const picked = await vscode.window.showQuickPick(model.supportedReasoningEfforts.map(e => ({ label: e.reasoningEffort, detail: e.description })), { title: '选择思考强度' });
      if (picked) next.effort = picked.label;
    } else {
      const model = session.models.find(m => m.model === next.model);
      if (!supportsFast(model)) { vscode.window.showInformationMessage('当前模型未声明支持快速模式。'); await reveal(record, true); return; }
      const picked = await vscode.window.showQuickPick([{ label: '开启', value: true, detail: '使用快速服务档位，可能增加额度消耗。' }, { label: '关闭', value: false }], { title: '快速模式' });
      if (picked) next.fast = picked.value;
    }
    if (!valid(record)) return;
    session.settings = validateSettings(session.models, next);
    await extensionContext.globalState.update('modelSettings', session.settings);
    await reveal(record, true);
  }
  async function save(record) {
    if (record.busy) return;
    const complete = completedMessages(record.messages);
    if (!complete.some(m => m.role === 'assistant')) throw new Error('请先完成一次讲解。');
    const id = noteId(record.source, complete);
    if (record.savedId === id) { vscode.window.setStatusBarMessage('这份讲解已经保存。', 4000); return; }
    record.busy = true;
    record.status = '正在整理精简笔记…';
    record.error = '';
    await reveal(record);
    try {
      const configuration = vscode.workspace.getConfiguration('codexExplain', record.uri);
      const folder = vscode.workspace.getWorkspaceFolder(record.uri);
      let configured = configuration.get('notesPath', '').trim();
      if (!configured) {
        const chosen = await vscode.window.showSaveDialog({ title: '选择 Markdown 笔记（追加保存）', filters: { Markdown: ['md'] }, defaultUri: folder ? vscode.Uri.joinPath(folder.uri, 'notes', '代码讲解.md') : undefined });
        if (!chosen) return;
        if (chosen.scheme !== 'file') throw new Error('请指定当前扩展宿主上的本地 Markdown 文件。');
        configured = chosen.fsPath;
        await configuration.update('notesPath', configured, folder ? vscode.ConfigurationTarget.WorkspaceFolder : vscode.ConfigurationTarget.Global);
      }
      const destination = path.isAbsolute(configured) ? configured : folder?.uri.scheme === 'file' ? path.resolve(folder.uri.fsPath, configured) : null;
      if (!destination || !/\.md$/i.test(destination)) throw new Error('请设置有效的 .md 文件路径。');
      function ensureSaved() {
        if (vscode.workspace.textDocuments.some(doc => doc.uri.scheme === 'file' && path.resolve(doc.uri.fsPath).toLowerCase() === destination.toLowerCase() && doc.isDirty)) throw new Error('笔记存在未保存编辑，请先保存该文件。');
      }
      ensureSaved();
      await connect(record);
      if (!valid(record)) return;
      if (record.cancelRequested) throw new Error('已停止。');
      if (record.noteCache?.id !== id) record.noteCache = { id, text: await record.session.run(notePrompt(complete), () => {}, { fresh: true }) };
      if (!valid(record)) return;
      ensureSaved();
      await appendNote(destination, record.source, record.noteCache.text, id);
      record.savedId = id;
      record.status = '精简笔记已保存。';
      vscode.window.setStatusBarMessage(`Codex 笔记已追加：${destination}`, 6000);
    } finally { record.busy = false; record.cancelRequested = false; if (record.status === '正在整理精简笔记…') record.status = ''; await reveal(record); }
  }
  function register(command, handler) {
    extensionContext.subscriptions.push(vscode.commands.registerCommand(command, async (...args) => {
      try { return await handler(...args); }
      catch (error) { if (!disposed) vscode.window.showErrorMessage(redact(error.message || String(error))); }
    }));
  }
  register('codexExplain.explain', explain);
  register('codexExplain.settings', () => vscode.commands.executeCommand('workbench.action.openSettings', '@ext:local-learning.codex-code-explain'));
  const handlers = { ask: record => ask(record), quote: record => ask(record, true), options, save,
    stop: async record => { record.cancelRequested = true; await record.session?.cancel(); },
    retry: record => record.lastRequest && answer(record, record.lastRequest.prompt, record.lastRequest.label),
    forget: async record => { forget(record); await vscode.commands.executeCommand('editor.action.hideHover'); }
  };
  for (const [name, handler] of Object.entries(handlers)) register(`codexExplain.hover.${name}`, async id => {
    const record = records.get(id);
    if (valid(record)) await handler(record);
  });
  extensionContext.subscriptions.push(vscode.workspace.onDidChangeTextDocument(event => {
    if (!event.contentChanges.length) return;
    for (const record of records.values()) if (record.uri.toString() === event.document.uri.toString()) forget(record);
  }));
  extensionContext.subscriptions.push(vscode.workspace.onDidCloseTextDocument(document => {
    for (const record of records.values()) if (record.uri.toString() === document.uri.toString()) forget(record);
  }));
  extensionContext.subscriptions.push({ dispose: () => { disposed = true; for (const record of records.values()) forget(record); } });
}
module.exports = { activate };
