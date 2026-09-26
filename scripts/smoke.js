'use strict';
const path = require('node:path');
const fs = require('node:fs/promises');
const { resolveCodex } = require('../src/resolve-codex');
const { CodexSession } = require('../src/codex');
const { notePrompt } = require('../src/prompts');
const { appendNote, noteId } = require('../src/notes');

(async () => {
  const directory = path.resolve(__dirname, '../artifacts/smoke-session');
  await fs.mkdir(directory, { recursive: true });
  const session = new CodexSession(resolveCodex(process.env.CODEX_EXPLAIN_BINARY), directory);
  try {
    const { models, settings } = await session.connect();
    console.log(JSON.stringify({ connected: true, modelCount: models.length, settings }));
    if (process.argv.includes('--generate') || process.argv.includes('--full')) {
      let chunks = 0;
      const text = await session.run('Briefly explain the following test code under Origin, Structure, and Usage. File example.js, line 1: function greet(name = "world") { return `Hello, ${name}`; }. Do not use tools.', () => { chunks++; });
      await fs.writeFile(path.join(directory, 'response.md'), text, 'utf8');
      console.log(JSON.stringify({ generated: true, chunks, characters: text.length, output: path.join(directory, 'response.md') }));
      if (process.argv.includes('--full')) {
        const followup = await session.run('Quote from your previous explanation: parameter name. Follow-up: Can this name be changed? Answer in one or two sentences.', () => {});
        const messages = [{ role: 'assistant', text }, { role: 'assistant', text: followup }];
        const note = await session.run(notePrompt(messages), () => {}, { fresh: true });
        const source = { file: 'example.js', selection: { startLine: 1, endLine: 1 } };
        const filename = path.join(directory, 'notes.md');
        await appendNote(filename, source, note, noteId(source, messages));
        console.log(JSON.stringify({ followup: followup.length, note: note.length, saved: filename }));
        const cancelled = session.run('Explain every JavaScript semantic detail of this function at great length, at least 3,000 words.', () => {});
        const cancelResult = cancelled.then(() => 'completed', error => error.message);
        const timer = setInterval(() => { if (session.active?.turnId) { clearInterval(timer); session.cancel().catch(() => {}); } }, 30);
        try { const status = await cancelResult; if (status !== 'Stopped.') throw new Error(`Cancellation verification failed: ${status}`); console.log('cancel: PASS'); }
        finally { clearInterval(timer); }
      }
    }
  } finally { session.dispose(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
