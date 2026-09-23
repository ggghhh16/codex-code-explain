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
        assert.ok(!context.types.some(text => text.includes('Codex 代码讲解')), 'our hover must not contaminate language-service context');
        let chunks = 0;
        const text = await originalRun.call(this, prompt, value => { chunks++; onText(value); }, options);
        assert.ok(text.includes('来源')); assert.ok(text.includes('结构')); assert.ok(text.includes('用法'));
        resolveResult({ activated: true, contextIncluded: true, definitions: context.definitions.length, types: context.types.length, chunks, characters: text.length });
        return text;
      } catch (error) { rejectResult(error); throw error; }
    };
    const extension = vscode.extensions.getExtension('local-learning.codex-code-explain');
    assert.ok(extension, 'extension discoverable');
    await extension.activate();
    assert.ok((await vscode.commands.getCommands(true)).includes('codexExplain.explain'));
    const fixturePath = path.join(root, 'artifacts', 'example.js');
    await fs.writeFile(fixturePath, 'function greet(name = "世界") { return `你好，${name}`; }\nconst message = greet("小明");\n');
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(fixturePath));
    const editor = await vscode.window.showTextDocument(document);
    editor.selection = new vscode.Selection(1, 16, 1, 21);
    await vscode.commands.executeCommand('vscode.executeDefinitionProvider', document.uri, editor.selection.start);
    const tabsBefore = vscode.window.tabGroups.all.flatMap(group => group.tabs).length;
    await vscode.commands.executeCommand('codexExplain.explain');
    const result = await Promise.race([completed, new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error('VS Code 端到端讲解未在 120 秒内完成')), 120000); })]);
    const hovers = await vscode.commands.executeCommand('vscode.executeHoverProvider', document.uri, editor.selection.start);
    const ownHover = hovers.find(hover => hover.contents.some(content => content.value?.includes('Codex 代码讲解')));
    assert.ok(ownHover, 'Codex answer is in native HoverProvider');
    assert.ok(ownHover.contents.some(content => content.value?.includes('来源')));
    assert.ok(hovers.length >= 2, 'native language hover is preserved');
    assert.equal(vscode.window.tabGroups.all.flatMap(group => group.tabs).length, tabsBefore, 'no new editor tab');
    assert.ok(!vscode.window.tabGroups.all.flatMap(group => group.tabs).some(tab => tab.input instanceof vscode.TabInputWebview), 'no webview panel');
    result.nativeHover = true;
    result.noNewTab = true;
    result.hoverProviders = hovers.length;
    await fs.writeFile(resultPath, JSON.stringify(result, null, 2));
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    console.log('PASS: 真实 Codex 回答位于原生 Hover，保留语言服务提示，无新标签页或 Webview。');
  } catch (error) {
    await fs.writeFile(resultPath, JSON.stringify({ failed: error.message }));
    throw error;
  } finally { clearTimeout(deadline); CodexSession.prototype.run = originalRun; }
}
module.exports = { run };
