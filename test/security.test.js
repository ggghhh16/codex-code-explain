'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { isSensitiveFile, redact, sourceLabel } = require('../src/context');
const { resolveCodex } = require('../src/resolve-codex');
const { appendNote } = require('../src/notes');

test('credential paths cover Windows separators and common configuration files', () => {
  for (const filename of ['C:\\Users\\example\\.ssh\\config', '/home/example/.aws/config', '/repo/.npmrc', '/repo/.env.production', '/repo/credentials.json']) assert.equal(isSensitiveFile(filename), true);
  assert.equal(isSensitiveFile('/repo/context.js'), false);
});
test('quoted JSON, unquoted env, Bearer, connection passwords and private keys are redacted', () => {
  for (const input of ['{"password": "fixture-only-value"}', 'TOKEN=fixture-only-value', 'Authorization: Bearer fixture-only-value', 'postgres://user:fixture-only-value@localhost/db', '-----BEGIN PRIVATE KEY-----\nfixture-only-value\n-----END PRIVATE KEY-----']) assert.ok(!redact(input).includes('fixture-only-value'));
});
test('outside-workspace source labels do not expose user home paths', () => {
  const api = { workspace: { getWorkspaceFolder: () => undefined } };
  assert.equal(sourceLabel(api, { path: '/home/private-person/project/file.js' }), 'external/file.js');
});
test('relative executable paths are rejected', () => {
  assert.throws(() => resolveCodex('./codex.exe'), /must be absolute/);
});
test('a Markdown hardlink cannot redirect note writes to another file', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-note-security-'));
  try {
    const original = path.join(directory, 'original.txt');
    await fs.writeFile(original, 'untouched');
    const link = path.join(directory, 'note.md');
    await fs.link(original, link);
    await assert.rejects(appendNote(link, {}, 'text', 'id'), /hard link/);
    assert.equal(await fs.readFile(original, 'utf8'), 'untouched');
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
