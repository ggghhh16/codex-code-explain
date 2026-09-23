'use strict';
const vscode = require('vscode');
const path = require('node:path');
const fs = require('node:fs/promises');
const { randomUUID } = require('node:crypto');
const { collectContext, redact } = require('./context');
const { resolveCodex } = require('./resolve-codex');
const { CodexSession, validateSettings } = require('./codex');
const { initialPrompt, followupPrompt, notePrompt } = require('./prompts');
const { appendNote, noteId } = require('./notes');
const { renderHtml } = require('./view');

function activate(extensionContext) {
  const panels = new Set();
  extensionContext.subscriptions.push(vscode.commands.registerCommand('codexExplain.explainInPanel', async () => {
    let session;
    let panel;
    try {
      if (!vscode.workspace.isTrusted) throw new Error('请先信任当前工作区。');
      const editor = vscode.window.activeTextEditor;
      if (!editor) throw new Error('请在代码编辑器中框选需要解释的内容。');
      const sourceUri = editor.document.uri;
      const sourceSelection = editor.selection;
      const folder = vscode.workspace.getWorkspaceFolder(sourceUri);
      const configuration = vscode.workspace.getConfiguration('codexExplain', sourceUri);
      const source = await collectContext(vscode, editor, configuration);
      const executable = resolveCodex(configuration.get('codexPath'), vscode.extensions.all);
      // A neutral cwd prevents project instruction discovery; only collected context is provided.
      const sessionDirectory = path.join(extensionContext.globalStorageUri.fsPath, 'sessions');
      await fs.mkdir(sessionDirectory, { recursive: true });
      session = new CodexSession(executable, sessionDirectory);
      panel = vscode.window.createWebviewPanel('codexExplain', `讲解 · ${path.basename(sourceUri.fsPath)}`, vscode.ViewColumn.Beside, {
        enableScripts: true, retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionContext.extensionUri, 'media')]
      });
      panels.add(panel);
      let disposed = false;
      let busy = false;
      let initialized = false;
      let lastRequest;
      let savedId;
      let noteCache;
      const messages = [];
      const completedMessages = () => messages.filter((message, index) => message.complete && (message.role === 'assistant' || messages[index + 1]?.role === 'assistant' && messages[index + 1].complete));
      const send = message => { if (!disposed) panel.webview.postMessage(message); };
      const report = error => send({ type: 'error', text: redact(error.message || String(error)) + (!initialized ? ' 请关闭此讲解，检查 Codex 登录和程序路径后重新打开。' : ''), canRetry: !!lastRequest });
      const update = () => send({ type: 'state', source, messages, busy, settings: session.settings, models: session.models, saved: savedId === noteId(source, completedMessages()), notesPath: vscode.workspace.getConfiguration('codexExplain', sourceUri).get('notesPath') || '首次保存时选择文件' });
      panel.onDidDispose(() => { disposed = true; session.dispose(); panels.delete(panel); });
      async function answer(prompt, label) {
        if (busy || !initialized) return;
        busy = true;
        lastRequest = { prompt, label };
        const question = { id: randomUUID(), role: 'user', text: label, complete: true };
        const response = { id: randomUUID(), role: 'assistant', text: '', complete: false };
        messages.push(question, response);
        update();
        try {
          response.text = await session.run(prompt, text => { response.text = text; send({ type: 'delta', id: response.id, text }); });
          response.complete = true;
          lastRequest = null;
        } catch (error) { response.interrupted = true; report(error); }
        finally { busy = false; update(); }
      }
      async function saveNote() {
        if (busy || !initialized) return;
        const complete = completedMessages();
        if (!complete.some(m => m.role === 'assistant')) throw new Error('先完成一次讲解，再保存笔记。');
        const id = noteId(source, complete);
        if (savedId === id) { send({ type: 'notice', text: '这份讲解已保存。' }); return; }
        busy = true;
        update();
        try {
          let configured = vscode.workspace.getConfiguration('codexExplain', sourceUri).get('notesPath', '').trim();
          let destination;
          if (!configured) {
            const chosen = await vscode.window.showSaveDialog({ title: '选择代码讲解笔记（追加，不覆盖）', filters: { Markdown: ['md'] }, defaultUri: folder ? vscode.Uri.joinPath(folder.uri, 'notes', '代码讲解.md') : undefined });
            if (!chosen) return;
            if (chosen.scheme !== 'file') throw new Error('首版笔记保存支持当前扩展宿主上的本地 Markdown 文件。');
            configured = chosen.fsPath;
            await vscode.workspace.getConfiguration('codexExplain', sourceUri).update('notesPath', configured, folder ? vscode.ConfigurationTarget.WorkspaceFolder : vscode.ConfigurationTarget.Global);
          }
          if (path.isAbsolute(configured)) destination = configured;
          else if (folder?.uri.scheme === 'file') destination = path.resolve(folder.uri.fsPath, configured);
          else throw new Error('请在插件设置中填写笔记文件的绝对路径。');
          if (!/\.md$/i.test(destination)) throw new Error('笔记路径必须以 .md 结尾。');
          if (vscode.workspace.textDocuments.some(doc => doc.uri.scheme === 'file' && path.resolve(doc.uri.fsPath).toLowerCase() === path.resolve(destination).toLowerCase() && doc.isDirty)) throw new Error('笔记文件存在尚未保存的编辑，请先保存该文件再追加。');
          send({ type: 'notice', text: '正在整理来源、结构、用法…' });
          if (noteCache?.id !== id) noteCache = { id, text: await session.run(notePrompt(complete), () => {}, { fresh: true }) };
          if (vscode.workspace.textDocuments.some(doc => doc.uri.scheme === 'file' && path.resolve(doc.uri.fsPath).toLowerCase() === path.resolve(destination).toLowerCase() && doc.isDirty)) throw new Error('笔记文件在整理期间被编辑，请先保存文件再重试；已整理的内容会保留。');
          const appended = await appendNote(destination, source, noteCache.text, id);
          savedId = id;
          send({ type: 'notice', text: appended ? `已追加笔记：${destination}` : '这份笔记已经存在，没有重复追加。' });
        } finally { busy = false; update(); }
      }
      panel.webview.onDidReceiveMessage(async message => {
        try {
          if (!message || typeof message.type !== 'string') return;
          if (message.type === 'ready') {
            update();
            if (initialized || busy) return;
            busy = true;
            send({ type: 'notice', text: '正在连接本机 Codex…' });
            update();
            try { await session.connect(extensionContext.globalState.get('modelSettings', {})); initialized = true; }
            finally { busy = false; update(); }
            await answer(initialPrompt(source), '解释这段代码的来源、结构和用法');
          } else if (message.type === 'ask' && typeof message.text === 'string' && message.text.trim()) {
            if (message.text.length > 8000 || (message.quote?.length || 0) > 12000) throw new Error('追问或引用过长，请缩短。');
            const text = redact(message.text.trim());
            const quote = typeof message.quote === 'string' ? redact(message.quote) : '';
            await answer(followupPrompt(text, quote), quote ? `引用：${quote}\n\n${text}` : text);
          } else if (message.type === 'settings' && !busy && initialized) {
            session.settings = validateSettings(session.models, message.settings || {});
            await extensionContext.globalState.update('modelSettings', session.settings);
            update();
            send({ type: 'notice', text: '已设置，下次提问生效。' });
          } else if (message.type === 'cancel') { await session.cancel(); }
          else if (message.type === 'save') await saveNote();
          else if (message.type === 'retry' && lastRequest && !busy) await answer(lastRequest.prompt, lastRequest.label);
          else if (message.type === 'openSettings') await vscode.commands.executeCommand('codexExplain.settings');
          else if (message.type === 'source') {
            const current = await vscode.workspace.openTextDocument(sourceUri);
            if (current.version !== source.documentVersion) vscode.window.showInformationMessage('源码已变化，讲解对应的是此前选区快照。');
            const shown = await vscode.window.showTextDocument(current, { viewColumn: vscode.ViewColumn.One, preserveFocus: false });
            shown.selection = sourceSelection;
            shown.revealRange(sourceSelection, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
          }
        } catch (error) { report(error); }
      });
      panel.webview.html = renderHtml({ root: extensionContext.extensionPath, resource: file => panel.webview.asWebviewUri(vscode.Uri.joinPath(extensionContext.extensionUri, 'media', file)).toString(), cspSource: panel.webview.cspSource });
    } catch (error) { session?.dispose(); panel?.dispose(); vscode.window.showErrorMessage(error.message || String(error)); }
  }));
  extensionContext.subscriptions.push({ dispose: () => { for (const panel of panels) panel.dispose(); } });
}
module.exports = { activate };
