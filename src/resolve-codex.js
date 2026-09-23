'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
function executable(filename) {
  try { return fs.statSync(filename).isFile(); } catch { return false; }
}
function resolveCodex(configured, extensions = []) {
  if (configured) {
    if (!path.isAbsolute(configured)) throw new Error('Codex 程序路径必须是绝对路径。');
    if (/\.(cmd|bat|ps1)$/i.test(configured)) throw new Error('请指定 Codex 原生可执行文件（Windows 为 codex.exe），不要指定脚本。');
    if (!executable(configured)) throw new Error('设置的 Codex 程序不存在，请检查 codexExplain.codexPath。');
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
  throw new Error('未找到 Codex。请安装并登录 Codex CLI，或在插件设置中填写 codexExplain.codexPath。');
}
module.exports = { resolveCodex };
