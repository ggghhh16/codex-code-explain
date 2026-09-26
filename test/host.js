'use strict';
// Executed by the real VS Code Extension Development Host, not plain Node.
const vscode = require('vscode');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { CodexSession } = require('../src/codex');

async function run() {
  const root = path.resolve(__dirname, '..');
  const resultPath = path.join(root, 'artifacts', 'host-result.json');
  const originalRun = CodexSession.prototype.run;
  let resolveResult, rejectResult;
  const completed = new Promise((resolve, reject) => { resolveResult = resolve; rejectResult = reject; });
  completed.catch(() => {});
  let deadline;
  try {
    CodexSession.prototype.run = async function(prompt, onText, options) {
      try {
        assert.ok(prompt.includes('greet'));
        assert.ok(prompt.includes('selection'));
        const context = JSON.parse(prompt.slice(prompt.indexOf('{')));
        assert.ok(context.definitions.length > 0, 'real language service returns definition');
        assert.ok(!context.types.some(text => text.includes('Codex Code Explainer')), 'our hover must not contaminate language-service context');
        let chunks = 0;
        const text = await originalRun.call(this, prompt, value => { chunks++; onText(value); }, options);
        assert.ok(text.includes('Origin')); assert.ok(text.includes('Structure')); assert.ok(text.includes('Usage'));
        resolveResult({ activated: true, contextIncluded: true, definitions: context.definitions.length, types: context.types.length, chunks, characters: text.length });
        return text;
      } catch (error) { rejectResult(error); throw error; }
    };
    const extension = vscode.extensions.getExtension('local-learning.codex-code-explain');
    assert.ok(extension, 'extension discoverable');
    await extension.activate();
    assert.ok((await vscode.commands.getCommands(true)).includes('codexExplain.explain'));
    const fixturePath = path.join(root, 'artifacts', 'example.js');
    await fs.writeFile(fixturePath, 'function greet(name = "world") { return `Hello, ${name}`; }\nconst message = greet("Alex");\n');
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(fixturePath));
    const editor = await vscode.window.showTextDocument(document);
    editor.selection = new vscode.Selection(1, 16, 1, 21);
    await vscode.commands.executeCommand('vscode.executeDefinitionProvider', document.uri, editor.selection.start);
    const tabsBefore = vscode.window.tabGroups.all.flatMap(group => group.tabs).length;
    await vscode.commands.executeCommand('codexExplain.explain');
    const result = await Promise.race([completed, new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error('VS Code end-to-end explanation did not finish within 120 seconds')), 120000); })]);
    const hovers = await vscode.commands.executeCommand('vscode.executeHoverProvider', document.uri, editor.selection.start);
    const ownHover = hovers.find(hover => hover.contents.some(content => content.value?.includes('Codex Code Explainer')));
    assert.ok(ownHover, 'Codex answer is in native HoverProvider');
    assert.ok(ownHover.contents.some(content => content.value?.includes('Origin')));
    assert.ok(hovers.length >= 2, 'native language hover is preserved');
    assert.equal(vscode.window.tabGroups.all.flatMap(group => group.tabs).length, tabsBefore, 'no new editor tab');
    assert.ok(!vscode.window.tabGroups.all.flatMap(group => group.tabs).some(tab => tab.input instanceof vscode.TabInputWebview), 'no webview panel');
    result.nativeHover = true;
    result.noNewTab = true;
    result.hoverProviders = hovers.length;
    await fs.writeFile(resultPath, JSON.stringify(result, null, 2));
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    console.log('PASS: Real Codex answer appears in native hover alongside language-service hints, without a new tab or Webview.');
  } catch (error) {
    await fs.writeFile(resultPath, JSON.stringify({ failed: error.message }));
    throw error;
  } finally { clearTimeout(deadline); CodexSession.prototype.run = originalRun; }
}
module.exports = { run };
