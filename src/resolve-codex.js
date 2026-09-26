'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
function executable(filename) {
  try { return fs.statSync(filename).isFile(); } catch { return false; }
}
function resolveCodex(configured, extensions = []) {
  if (configured) {
    if (!path.isAbsolute(configured)) throw new Error('The Codex executable path must be absolute.');
    if (/\.(cmd|bat|ps1)$/i.test(configured)) throw new Error('Select the native Codex executable (codex.exe on Windows), not a script.');
    if (!executable(configured)) throw new Error('The configured Codex executable does not exist. Check codexExplain.codexPath.');
    return configured;
  }
  const binary = process.platform === 'win32' ? 'codex.exe' : 'codex';
  for (const directory of (process.env.PATH || '').split(path.delimiter)) {
    const absoluteDirectory = directory.replace(/^"|"$/g, '');
    if (!absoluteDirectory || !path.isAbsolute(absoluteDirectory)) continue;
    const candidate = path.join(absoluteDirectory, binary);
    if (executable(candidate)) return candidate;
  }
  const desktop = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'OpenAI', 'Codex', 'bin');
  try {
    const versions = fs.readdirSync(desktop).map(name => path.join(desktop, name, binary)).filter(executable).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    if (versions.length) return versions[0];
  } catch {}
  for (const extension of extensions.filter(e => e.id === 'openai.chatgpt')) {
    for (const platform of ['windows-x86_64', 'windows-aarch64', 'darwin-aarch64', 'darwin-x86_64', 'linux-x86_64', 'linux-aarch64']) {
      const candidate = path.join(extension.extensionPath, 'bin', platform, binary);
      if (executable(candidate)) return candidate;
    }
  }
  throw new Error('Codex was not found. Install and sign in to Codex CLI, or set codexExplain.codexPath in extension settings.');
}
module.exports = { resolveCodex };
