'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { PassThrough } = require('node:stream');
const { EventEmitter } = require('node:events');
const { RpcClient } = require('../src/rpc');
const { CodexSession, validateSettings, supportsFast } = require('../src/codex');
const { appendNote, noteId } = require('../src/notes');
const { isSensitiveFile, redact } = require('../src/context');

function fakeProcess(onMessage) {
  const child = new EventEmitter();
  child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
  child.kill = () => child.emit('exit', 0);
  child.stdin.on('data', bytes => { for (const line of bytes.toString().trim().split('\n')) onMessage(JSON.parse(line), data => child.stdout.write(JSON.stringify(data) + '\n')); });
  return child;
}
test('JSON-RPC requests can resolve out of order; approval requests are declined', async () => {
  const incoming = [];
  let emit;
  const child = fakeProcess((message, reply) => { incoming.push(message); emit = reply; });
  const rpc = new RpcClient('fake', { spawn: () => child });
  const a = rpc.request('a'), b = rpc.request('b');
  emit({ id: incoming[1].id, result: 2 }); emit({ id: incoming[0].id, result: 1 });
  assert.deepEqual(await Promise.all([a, b]), [1, 2]);
  emit({ id: 99, method: 'item/commandExecution/requestApproval', params: {} });
  assert.deepEqual(incoming.at(-1), { id: 99, result: { decision: 'decline' } });
  rpc.dispose();
});
test('process crash rejects pending work and clears request timers', async () => {
  const child = fakeProcess(() => {});
  const rpc = new RpcClient('fake', { spawn: () => child });
  const pending = rpc.request('pending');
  child.emit('exit', 9);
  await assert.rejects(pending, /进程已退出/);
  assert.equal(rpc.pending.size, 0);
});
test('unknown model, effort and unsupported fast mode are rejected', () => {
  const models = [{ model: 'test', supportedReasoningEfforts: [{ reasoningEffort: 'medium' }], serviceTiers: [{ id: 'fast' }] }];
  assert.equal(supportsFast(models[0]), true);
  assert.throws(() => validateSettings(models, { model: 'invented', effort: 'medium' }));
  assert.throws(() => validateSettings(models, { model: 'test', effort: 'invented' }));
  assert.throws(() => validateSettings([{ ...models[0], serviceTiers: [] }], { model: 'test', effort: 'medium', fast: true }));
});
test('turn completion can arrive before turn/start response; late foreign events are ignored', async () => {
  const child = fakeProcess((message, reply) => {
    if (message.method === 'thread/start') reply({ id: message.id, result: { thread: { id: 't1' } } });
    if (message.method === 'turn/start') {
      reply({ method: 'item/agentMessage/delta', params: { threadId: 'foreign', turnId: 'x', itemId: 'bad', delta: 'bad' } });
      reply({ method: 'item/agentMessage/delta', params: { threadId: 't1', turnId: 'u1', itemId: 'm1', delta: '来源' } });
      reply({ method: 'item/completed', params: { threadId: 't1', turnId: 'u1', item: { type: 'agentMessage', id: 'm1', text: '来源：项目定义。' } } });
      reply({ method: 'turn/completed', params: { threadId: 't1', turn: { id: 'u1', status: 'completed' } } });
      reply({ id: message.id, result: { turn: { id: 'u1' } } });
    }
  });
  const session = new CodexSession('fake', os.tmpdir(), { spawn: () => child });
  session.settings = { model: 'test', effort: 'medium', fast: false };
  const text = await session.run('test', () => {});
  assert.equal(text, '来源：项目定义。'); assert.equal(session.active, null);
  session.dispose();
});
test('notes append without overwriting and deduplicate concurrent saves', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-explain-test-'));
  const filename = path.join(directory, 'notes.md');
  try {
    await fs.writeFile(filename, '# 原有笔记\n');
    const source = { file: 'test.js', selection: { startLine: 1, endLine: 2 } };
    const id = noteId(source, ['answer']);
    const results = await Promise.all([appendNote(filename, source, '来源：项目。', id), appendNote(filename, source, '来源：项目。', id)]);
    assert.deepEqual(results, [true, false]);
    const text = await fs.readFile(filename, 'utf8');
    assert.ok(text.startsWith('# 原有笔记\n')); assert.equal(text.split('<!-- codex-explain:').length, 2);
    await assert.rejects(appendNote(path.join(directory, 'notes.txt'), source, 'x', 'x'), /\.md/);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
test('credential files and common literal secrets are excluded', () => {
  assert.equal(isSensitiveFile('/x/.env.local'), true); assert.equal(isSensitiveFile('/x/index.ts'), false);
  assert.equal(redact('api_key = "secret-value"'), 'api_key = "[已隐藏凭据]"');
});
