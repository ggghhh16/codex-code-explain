'use strict';
const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { redact } = require('./context');
const queues = new Map();

function noteId(source, messages) {
  return createHash('sha256').update(JSON.stringify({ source, messages })).digest('hex').slice(0, 24);
}
function noteBlock(source, text, id, date = new Date()) {
  const title = `${source.file.replace(/[\r\n]/g, ' ')} · L${source.selection.startLine}–${source.selection.endLine}`;
  return `\n\n<!-- codex-explain:${id} -->\n## ${title}\n\n> ${date.toISOString()} · Code explanation note\n\n${redact(text.trim())}\n`;
}
async function appendNote(filename, source, text, id) {
  if (!/\.md$/i.test(filename)) throw new Error('The note path must point to a .md file.');
  const key = path.resolve(filename);
  const previous = queues.get(key) || Promise.resolve();
  const task = previous.catch(() => {}).then(async () => {
    await fs.mkdir(path.dirname(key), { recursive: true });
    try {
      const target = await fs.lstat(key);
      if (target.isSymbolicLink() || !target.isFile() || target.nlink > 1) throw new Error('The note target must be a regular file, not a symlink, directory, or hard link.');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    let old = '';
    try { old = await fs.readFile(key, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (old.includes(`<!-- codex-explain:${id} -->`)) return false;
    const handle = await fs.open(key, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | (constants.O_NOFOLLOW || 0), 0o600);
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.nlink > 1) throw new Error('The note target is not an independent regular file.');
      await handle.writeFile(noteBlock(source, text, id), 'utf8');
    } finally { await handle.close(); }
    return true;
  });
  queues.set(key, task);
  try { return await task; } finally { if (queues.get(key) === task) queues.delete(key); }
}
module.exports = { noteId, noteBlock, appendNote };
