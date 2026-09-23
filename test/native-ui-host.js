'use strict';
const vscode = require('vscode');
const fs = require('node:fs/promises');
const path = require('node:path');
const { CodexSession } = require('../src/codex');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function run() {
  const root = path.resolve(__dirname, '..');
  const directory = path.join(root, 'artifacts/native-ui');
  await fs.mkdir(directory, { recursive: true });
  const originalConnect = CodexSession.prototype.connect;
  const originalRun = CodexSession.prototype.run;
  const calls = [];
  CodexSession.prototype.connect = async function() {
    this.models = [{ model: 'ui-test', displayName: '界面测试模型', defaultReasoningEffort: 'medium', supportedReasoningEfforts: [{ reasoningEffort: 'low', description: '简短解释' }, { reasoningEffort: 'medium', description: '标准解释' }], serviceTiers: [{ id: 'fast' }] }];
    this.settings = { model: 'ui-test', effort: 'medium', fast: false };
    return { models: this.models, settings: this.settings };
  };
  CodexSession.prototype.run = async function(prompt, onText, options) {
    this.threadId = 'ui-thread';
    calls.push({ prompt, options, settings: { ...this.settings } });
    const text = options?.fresh ? '### 来源\n`greet` 是项目定义的函数。\n### 结构\n`name` 默认值为字符串。\n### 用法\n调用时返回问候语。' : calls.length === 1 ? '### 来源\n`greet` 是这个文件定义的函数；`name` 是项目自己命名的参数。\n\n### 结构\n参数由调用者传入；省略时使用 `"世界"`。函数返回一个字符串。\n\n### 用法\n`greet("小明")` 把 `"小明"` 传给 `name`，返回 `"你好，小明"`。这里只调用函数，没有打印。' : '可以改名。把函数中的 `name` 和模板字符串里的 `${name}` 一起改成 `person`，调用处的 `greet("小明")` 不需要改变。';
    onText(text);
    await fs.writeFile(path.join(directory, 'calls.json'), JSON.stringify(calls));
    return text;
  };
  try {
    await vscode.workspace.getConfiguration('editor').update('fontSize', 14, vscode.ConfigurationTarget.Global);
    await vscode.workspace.getConfiguration('window').update('zoomLevel', 0, vscode.ConfigurationTarget.Global);
    await vscode.workspace.getConfiguration('workbench').update('colorTheme', 'Default Dark Modern', vscode.ConfigurationTarget.Global);
    await vscode.workspace.getConfiguration('codexExplain').update('notesPath', path.join(directory, 'notes.md'), vscode.ConfigurationTarget.Global);
    const extension = vscode.extensions.getExtension('local-learning.codex-code-explain');
    await extension.activate();
    const filename = path.join(directory, 'example.js');
    await fs.writeFile(filename, '// 框选调用里的函数名 → 右键「用 Codex 解释」\n\nfunction greet(name = "世界") {\n  return `你好，${name}`;\n}\n\nconst message = greet("小明");\n');
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(filename));
    const editor = await vscode.window.showTextDocument(document);
    editor.selection = new vscode.Selection(6, 16, 6, 21);
    await vscode.commands.executeCommand('workbench.action.closeSidebar');
    await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');
    await vscode.commands.executeCommand('vscode.executeDefinitionProvider', document.uri, editor.selection.start);
    await vscode.commands.executeCommand('codexExplain.explain');
    await fs.writeFile(path.join(directory, 'ready'), 'ready');
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
      try { await fs.access(path.join(directory, 'done')); break; } catch {}
      await wait(200);
    }
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  } finally { CodexSession.prototype.connect = originalConnect; CodexSession.prototype.run = originalRun; }
}
module.exports = { run };
