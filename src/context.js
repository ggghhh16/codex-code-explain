'use strict';
const path = require('node:path');

function isSensitiveFile(filename) {
  const normalized = filename.replace(/\\/g, '/').toLowerCase();
  const name = path.posix.basename(normalized);
  return name === '.env' || name.startsWith('.env.') || /\.(pem|key|p12|pfx|keystore)$/.test(name)
    || ['auth.json', 'credentials.json', '.npmrc', '.pypirc', '.netrc', '_netrc', 'credentials', 'id_rsa', 'id_dsa', 'id_ecdsa', 'id_ed25519'].includes(name)
    || /\/(?:\.ssh|\.aws|\.kube|\.gnupg)\//.test(normalized);
}
function redact(text) {
  return String(text)
    .replace(/-----BEGIN (?:[A-Z ]*PRIVATE KEY)-----[\s\S]*?-----END (?:[A-Z ]*PRIVATE KEY)-----/g, '[已隐藏私钥]')
    .replace(/\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[A-Z0-9]{16})\b/g, '[已隐藏凭据]')
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, '$1[已隐藏凭据]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[已隐藏凭据]')
    .replace(/([a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:)[^\s/@]+(@)/gi, '$1[已隐藏凭据]$2')
    .replace(/(["']?\b(?:api[_-]?key|(?:access|refresh|auth)[_-]?token|token|password|passwd|secret|authorization|cookie|private[_-]?key)\b["']?\s*[:=]\s*)(["'])([^"'\r\n]+)\2/gi, '$1$2[已隐藏凭据]$2')
    .replace(/(\b(?:api[_-]?key|(?:access|refresh|auth)[_-]?token|token|password|passwd|secret|authorization|cookie)\b\s*[:=]\s*)(?!["'\s])([^\s,;#}]+)/gi, '$1[已隐藏凭据]');
}
function sourceLabel(vscode, uri) {
  const folder = vscode.workspace.getWorkspaceFolder(uri);
  return folder ? vscode.workspace.asRelativePath(uri, true) : `external/${path.posix.basename(uri.path || uri.fsPath.replace(/\\/g, '/'))}`;
}
function clipped(text, budget) {
  if (text.length <= budget) return text;
  return text.slice(0, Math.max(0, budget - 18)) + '\n[内容已截断]';
}
async function bounded(promise, fallback, ms = 2000) {
  let timer;
  try { return await Promise.race([promise, new Promise(resolve => { timer = setTimeout(() => resolve(fallback), ms); })]); }
  catch { return fallback; }
  finally { clearTimeout(timer); }
}
async function collectContext(vscode, editor, configuration) {
  const doc = editor.document;
  const selection = editor.selection;
  if (selection.isEmpty) throw new Error('请先框选要解释的代码。');
  if (isSensitiveFile(doc.uri.fsPath)) throw new Error('此文件可能包含凭据，不自动发送。请在普通代码文件中选择需要解释的表达式。');
  const max = configuration.get('maxContextCharacters', 24000);
  const selected = redact(doc.getText(selection));
  if (selected.length > max / 2) throw new Error('选区太长，请缩小到一个表达式、函数或相关代码块。');
  const lines = configuration.get('contextLines', 35);
  const endLine = selection.end.character === 0 && selection.end.line > selection.start.line ? selection.end.line - 1 : selection.end.line;
  const start = Math.max(0, selection.start.line - lines);
  const end = Math.min(doc.lineCount - 1, endLine + lines);
  const name = sourceLabel(vscode, doc.uri);
  const context = {
    file: name, language: doc.languageId, documentVersion: doc.version,
    selection: { startLine: selection.start.line + 1, endLine: endLine + 1, text: selected },
    nearby: '', types: [], definitions: [], limitations: []
  };
  let remaining = max - selected.length;
  if (lines > 0) {
    const nearby = Array.from({ length: end - start + 1 }, (_, i) => `${start + i + 1}: ${doc.lineAt(start + i).text}`).join('\n');
    context.nearby = clipped(redact(nearby), Math.floor(remaining * 0.55));
    remaining -= context.nearby.length;
  }
  // Ask about up to four distinct identifier positions inside the selection.
  const positions = [];
  const seen = new Set();
  for (const match of doc.getText(selection).matchAll(/[\p{L}_$][\p{L}\p{N}_$]*/gu)) {
    if (seen.has(match[0])) continue;
    seen.add(match[0]);
    positions.push(doc.positionAt(doc.offsetAt(selection.start) + match.index));
    if (positions.length === 4) break;
  }
  if (!positions.length) positions.push(selection.start);
  const results = await Promise.all(positions.map(async position => {
    const settled = await Promise.allSettled([
      bounded(vscode.commands.executeCommand('vscode.executeHoverProvider', doc.uri, position), []),
      bounded(vscode.commands.executeCommand('vscode.executeDefinitionProvider', doc.uri, position), [])
    ]);
    return settled.map(r => r.status === 'fulfilled' ? r.value || [] : []);
  }));
  const locations = new Set();
  for (const [hovers, definitions] of results) {
    for (const hover of hovers) {
      const text = redact(hover.contents.map(c => typeof c === 'string' ? c : c.value || '').join('\n'));
      const content = clipped(text, Math.min(2000, remaining));
      if (remaining > 100 && content && !context.types.includes(content)) { context.types.push(content); remaining -= content.length; }
    }
    for (const def of definitions) {
      if (context.definitions.length >= 4 || remaining < 200) break;
      const uri = def.targetUri || def.uri;
      const range = def.targetRange || def.range;
      if (!uri || !range || (!['file', 'vscode-remote'].includes(uri.scheme) && uri.toString() !== doc.uri.toString()) || isSensitiveFile(uri.fsPath)) continue;
      const key = `${uri.toString()}:${range.start.line}`;
      if (locations.has(key)) continue;
      locations.add(key);
      const target = uri.toString() === doc.uri.toString() ? doc : await bounded(vscode.workspace.openTextDocument(uri), null);
      if (!target) continue;
      const first = Math.max(0, range.start.line - 2);
      const last = Math.min(target.lineCount - 1, range.end.line + 5, first + 60);
      const text = Array.from({ length: last - first + 1 }, (_, i) => `${first + i + 1}: ${target.lineAt(first + i).text}`).join('\n');
      const content = clipped(redact(text), Math.min(4000, remaining));
      context.definitions.push({ file: sourceLabel(vscode, uri), line: range.start.line + 1, text: content });
      remaining -= content.length;
    }
  }
  if (!context.definitions.length) context.limitations.push('语言服务未提供定义；可能尚未启动、未安装或不支持该符号，不能据此推断来源。');
  context.limitations.push('只采集最多四个不同标识符的语言服务结果；未搜索整个项目。类型提示不等于运行时实际值。');
  if (JSON.stringify(context).includes('[内容已截断]')) context.limitations.push('上下文有截断。');
  return context;
}
module.exports = { collectContext, isSensitiveFile, redact, clipped, sourceLabel };
