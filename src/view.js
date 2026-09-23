'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
function renderHtml({ root, resource, cspSource }) {
  const nonce = randomBytes(18).toString('base64');
  return fs.readFileSync(path.join(root, 'media', 'index.html'), 'utf8')
    .replaceAll('{{CSP}}', `default-src 'none'; img-src ${cspSource} data:; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';`)
    .replaceAll('{{STYLE}}', resource('style.css'))
    .replaceAll('{{SCRIPT}}', resource('app.js'))
    .replaceAll('{{NONCE}}', nonce);
}
module.exports = { renderHtml };
