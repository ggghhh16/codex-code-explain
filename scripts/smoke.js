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
      const text = await session.run('请用来源、结构、用法三个小标题，简短解释以下测试代码。文件 example.js 第 1 行：function greet(name = "世界") { return `你好，${name}`; }。不得使用工具。', () => { chunks++; });
      await fs.writeFile(path.join(directory, 'response.md'), text, 'utf8');
      console.log(JSON.stringify({ generated: true, chunks, characters: text.length, output: path.join(directory, 'response.md') }));
      if (process.argv.includes('--full')) {
        const followup = await session.run('引用你的上一段讲解：参数 name。追问：这个名称可以改吗？只用一两句话回答。', () => {});
        const messages = [{ role: 'assistant', text }, { role: 'assistant', text: followup }];
        const note = await session.run(notePrompt(messages), () => {}, { fresh: true });
        const source = { file: 'example.js', selection: { startLine: 1, endLine: 1 } };
        const filename = path.join(directory, 'notes.md');
        await appendNote(filename, source, note, noteId(source, messages));
        console.log(JSON.stringify({ followup: followup.length, note: note.length, saved: filename }));
        const cancelled = session.run('请非常详细地解释这个函数的全部 JavaScript 语义，至少 3000 字。', () => {});
        const cancelResult = cancelled.then(() => 'completed', error => error.message);
        const timer = setInterval(() => { if (session.active?.turnId) { clearInterval(timer); session.cancel().catch(() => {}); } }, 30);
        try { const status = await cancelResult; if (status !== '已停止。') throw new Error(`停止验证失败：${status}`); console.log('cancel: PASS'); }
        finally { clearInterval(timer); }
      }
    }
  } finally { session.dispose(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
