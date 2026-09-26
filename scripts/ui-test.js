'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const { renderHtml } = require('../src/view');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

(async () => {
  const root = path.resolve(__dirname, '..');
  const directory = path.join(root, 'artifacts');
  await fs.mkdir(directory, { recursive: true });
  const server = http.createServer(async (request, response) => {
    if (request.url === '/') { response.setHeader('Content-Type', 'text/html'); response.end(renderHtml({ root, resource: name => '/' + name, cspSource: "'self'" })); return; }
    const name = request.url.slice(1);
    if (!['app.js', 'style.css'].includes(name)) { response.writeHead(404); response.end(); return; }
    response.setHeader('Content-Type', name.endsWith('js') ? 'application/javascript' : 'text/css');
    response.end(await fs.readFile(path.join(root, 'media', name)));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const page = await browser.newPage({ viewport: { width: 1260, height: 920 }, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => {
      window.sent = [];
      window.acquireVsCodeApi = () => ({ postMessage: message => window.sent.push(message), getState: () => undefined, setState: () => {} });
    });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(() => window.sent.some(m => m.type === 'ready'));
    const fixture = { type: 'state', busy: false, saved: false, notesPath: 'notes/code-explanations.md', source: { file: 'src/server.py', selection: { startLine: 24, endLine: 24, text: 'request.app.state.run_service' }, definitions: [{ file: 'src/server.py', line: 12 }], nearby: '12: app.state.run_service = service' }, settings: { model: 'demo', effort: 'medium', fast: false }, models: [{ model: 'demo', displayName: 'GPT · Test model', supportedReasoningEfforts: [{ reasoningEffort: 'low', description: 'Good for simple origin questions' }, { reasoningEffort: 'medium', description: 'Balances detail and speed' }, { reasoningEffort: 'high', description: 'Good for complex object relationships' }], defaultReasoningEffort: 'medium', serviceTiers: [{ id: 'fast', description: 'Faster answers may consume more quota.' }] }], messages: [{ id: 'u1', role: 'user', text: "Explain this code's origin, structure, and usage", complete: true }, { id: 'a1', role: 'assistant', complete: true, text: '### Origin\nThe framework supplies `request`; `app` and `state` come from the framework. The project chose the name `run_service`, defined at `src/server.py:12`.\n### Structure\n`request.app` points to the app handling this request. `state.run_service` holds a service object created at startup, not one created per request.\n```python\napp.state.run_service = service\n```\n### Usage\nAt startup, the project creates `service` and stores it on app `state`. A request retrieves that same object.\n**Note:** The project chooses property names; inspect the code to find where an object is created and stored.' }] };
    await page.evaluate(data => window.postMessage(data, '*'), fixture);
    await page.locator('#settings-toggle').click();
    assert.equal(await page.locator('#settings').isVisible(), true);
    await page.screenshot({ path: path.join(directory, 'ui-wide.png') });
    // Selection-based follow-up preserves the exact quote and input.
    await page.evaluate(() => {
      const range = document.createRange(); range.selectNodeContents(document.querySelector('#a1 p'));
      const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
      document.getElementById('conversation').dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    await page.locator('#quote-action').click();
    await page.locator('#question').fill('Can run_service be renamed?');
    await page.locator('#send').click();
    const ask = await page.evaluate(() => window.sent.find(m => m.type === 'ask'));
    assert.ok(ask.quote.includes('run_service')); assert.equal(ask.text, 'Can run_service be renamed?');
    await page.locator('#fast').click();
    assert.equal(await page.evaluate(() => window.sent.filter(m => m.type === 'settings').at(-1).settings.fast), true);
    await page.locator('#save').click();
    assert.ok(await page.evaluate(() => window.sent.some(m => m.type === 'save')));
    await page.locator('#settings-close').click();
    // Every corner actually changes geometry.
    for (const corner of ['se', 'sw', 'nw', 'ne']) {
      const before = await page.locator('#window').boundingBox();
      const handle = await page.locator('.' + corner).boundingBox();
      const dx = corner.includes('w') ? 20 : -20;
      const dy = corner.includes('n') ? 15 : -15;
      await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
      await page.mouse.down(); await page.mouse.move(handle.x + handle.width / 2 + dx, handle.y + handle.height / 2 + dy, { steps: 5 }); await page.mouse.up();
      const after = await page.locator('#window').boundingBox();
      assert.ok(Math.abs(after.width - before.width) > 10, `resize ${corner}`);
    }
    // Model text cannot become executable HTML, remote images or command links.
    fixture.messages[1].text = '<img src=x onerror="window.pwned=true"><script>window.pwned=true</script>\n[run](command:workbench.action.closeWindow)';
    await page.evaluate(data => window.postMessage(data, '*'), fixture);
    assert.equal(await page.locator('#a1 img,#a1 script,#a1 a').count(), 0);
    assert.equal(await page.evaluate(() => !!window.pwned), false);
    fixture.messages[1].text = '### Origin\nThis function is defined by the project.\n### Structure\nThe parameter is a string.\n### Usage\nIt receives input and returns a result.';
    await page.evaluate(data => window.postMessage(data, '*'), fixture);
    await page.setViewportSize({ width: 480, height: 760 });
    await page.locator('#settings-toggle').click();
    const settings = await page.locator('#settings').boundingBox();
    assert.ok(settings.x >= 0 && settings.x + settings.width <= 480);
    await page.screenshot({ path: path.join(directory, 'ui-narrow.png') });
    assert.deepEqual(errors, []);
    console.log('PASS: Browser quote follow-up, fast mode, save event, four-corner resizing, narrow layout, and output escaping.');
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
