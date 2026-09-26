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
    .replace(/-----BEGIN (?:[A-Z ]*PRIVATE KEY)-----[\s\S]*?-----END (?:[A-Z ]*PRIVATE KEY)-----/g, '[private key redacted]')
    .replace(/\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[A-Z0-9]{16})\b/g, '[credential redacted]')
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, '$1[credential redacted]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[credential redacted]')
    .replace(/([a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:)[^\s/@]+(@)/gi, '$1[credential redacted]$2')
    .replace(/(["']?\b(?:api[_-]?key|(?:access|refresh|auth)[_-]?token|token|password|passwd|secret|authorization|cookie|private[_-]?key)\b["']?\s*[:=]\s*)(["'])([^"'\r\n]+)\2/gi, '$1$2[credential redacted]$2')
    .replace(/(\b(?:api[_-]?key|(?:access|refresh|auth)[_-]?token|token|password|passwd|secret|authorization|cookie)\b\s*[:=]\s*)(?!["'\s])([^\s,;#}]+)/gi, '$1[credential redacted]');
}
function sourceLabel(vscode, uri) {
  const folder = vscode.workspace.getWorkspaceFolder(uri);
  return folder ? vscode.workspace.asRelativePath(uri, true) : `external/${path.posix.basename(uri.path || uri.fsPath.replace(/\\/g, '/'))}`;
}
function clipped(text, budget) {
  if (text.length <= budget) return text;
  return text.slice(0, Math.max(0, budget - 18)) + '\n[content truncated]';
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
  if (selection.isEmpty) throw new Error('Select code to explain first.');
  if (isSensitiveFile(doc.uri.fsPath)) throw new Error('This file may contain credentials and will not be sent automatically. Select an expression in a regular code file.');
  const max = configuration.get('maxContextCharacters', 24000);
  const selected = redact(doc.getText(selection));
  if (selected.length > max / 2) throw new Error('The selection is too long. Narrow it to an expression, function, or relevant block.');
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
  if (!context.definitions.length) context.limitations.push('The language service returned no definition. It may be inactive, missing, or unable to resolve this symbol; its origin cannot be inferred.');
  context.limitations.push('Language-service results were collected for at most four distinct identifiers; the project was not searched. Type hints do not establish runtime values.');
  if (JSON.stringify(context).includes('[content truncated]')) context.limitations.push('Some context was truncated.');
  return context;
}
module.exports = { collectContext, isSensitiveFile, redact, clipped, sourceLabel };
