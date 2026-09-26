'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { safeMarkdown, commandLink, quoteChoices, completedMessages } = require('../src/hover-content');

test('model markdown cannot produce executable links or remote images; code syntax stays exact', () => {
  const text = '[run](command:codexExplain.hover.save) ![x](https://example.com/x) <img src=x>\n`data[0]`\n```js\nconst a = data[0];\n```';
  const safe = safeMarkdown(text);
  assert.ok(!safe.includes('[run]'));
  assert.ok(!safe.includes('![x]'));
  assert.ok(!safe.includes('<img'));
  assert.ok(safe.includes('`data[0]`'));
  assert.ok(safe.includes('const a = data[0];'));
  assert.ok(!safeMarkdown('`unterminated ![x](https://example.com/x)').includes('![x]'));
});
test('trusted action URI carries only the opaque session id', () => {
  const link = commandLink('Save', 'codexExplain.hover.save', 'id/Chinese');
  const encoded = link.match(/\?([^)]*)/)[1];
  assert.deepEqual(JSON.parse(decodeURIComponent(encoded)), ['id/Chinese']);
});
test('quote and note exclude unfinished answers and unanswered questions', () => {
  const messages = [
    { role: 'user', text: 'Explain', complete: true },
    { role: 'assistant', text: 'Origin: project.\n\nUsage: pass a parameter.', complete: true },
    { role: 'user', text: 'New follow-up', complete: true },
    { role: 'assistant', text: 'Incomplete', complete: false }
  ];
  assert.equal(completedMessages(messages).length, 2);
  assert.deepEqual(quoteChoices(messages).map(x => x.quote), ['Origin: project.', 'Usage: pass a parameter.']);
});
