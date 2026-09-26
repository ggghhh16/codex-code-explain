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
    this.models = [{ model: 'ui-test', displayName: 'UI test model', defaultReasoningEffort: 'medium', supportedReasoningEfforts: [{ reasoningEffort: 'low', description: 'Short explanation' }, { reasoningEffort: 'medium', description: 'Standard explanation' }], serviceTiers: [{ id: 'fast' }] }];
    this.settings = { model: 'ui-test', effort: 'medium', fast: false };
    return { models: this.models, settings: this.settings };
  };
  CodexSession.prototype.run = async function(prompt, onText, options) {
    this.threadId = 'ui-thread';
    calls.push({ prompt, options, settings: { ...this.settings } });
    const text = options?.fresh ? '### Origin\nThe project defines `greet`.\n### Structure\nThe default for `name` is a string.\n### Usage\nCalling it returns a greeting.' : calls.length === 1 ? '### Origin\nThis file defines `greet`; the project chose the parameter name `name`.\n\n### Structure\nThe caller passes the parameter; when omitted, it uses `"world"`. The function returns a string.\n\n### Usage\n`greet("Alex")` passes `"Alex"` to `name` and returns `"Hello, Alex"`. This only calls the function; it does not print.' : 'It can be renamed. Change `name` in the function and `${name}` in the template string to `person`; the `greet("Alex")` call need not change.';
    onText(text);
    await fs.writeFile(path.join(directory, 'calls.json'), JSON.stringify(calls));
    return text;
  };
  try {
    await vscode.workspace.getConfiguration('editor').update('fontSize', 14, vscode.ConfigurationTarget.Global);
    await vscode.workspace.getConfiguration('window').update('zoomLevel', 0, vscode.ConfigurationTarget.Global);
    await vscode.workspace.getConfiguration('workbench').update('colorTheme', 'Default Dark Modern', vscode.ConfigurationTarget.Global);
    await vscode.workspace.getConfiguration('codexExplain').update('notesPath', path.join(directory, 'notes.md'), vscode.ConfigurationTarget.Global);
    const extension = vscode.extensions.getExtension('Principia.codex-code-explain');
    await extension.activate();
    const filename = path.join(directory, 'example.js');
    await fs.writeFile(filename, '// Select the function name in the call, then choose Explain with Codex\n\nfunction greet(name = "world") {\n  return `Hello, ${name}`;\n}\n\nconst message = greet("Alex");\n');
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
