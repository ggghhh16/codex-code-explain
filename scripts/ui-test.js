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
    const fixture = { type: 'state', busy: false, saved: false, notesPath: 'notes/代码讲解.md', source: { file: 'src/server.py', selection: { startLine: 24, endLine: 24, text: 'request.app.state.run_service' }, definitions: [{ file: 'src/server.py', line: 12 }], nearby: '12: app.state.run_service = service' }, settings: { model: 'demo', effort: 'medium', fast: false }, models: [{ model: 'demo', displayName: 'GPT · 测试模型', supportedReasoningEfforts: [{ reasoningEffort: 'low', description: '适合简单的来源查询' }, { reasoningEffort: 'medium', description: '兼顾解释完整性与响应速度' }, { reasoningEffort: 'high', description: '适合复杂对象关系' }], defaultReasoningEffort: 'medium', serviceTiers: [{ id: 'fast', description: '加快回答，可能增加额度消耗。' }] }], messages: [{ id: 'u1', role: 'user', text: '解释这段代码的来源、结构和用法', complete: true }, { id: 'a1', role: 'assistant', complete: true, text: '### 来源\n`request` 是框架传入的请求对象；`app` 和 `state` 来自框架。`run_service` 是项目自己选的属性名，定义在 `src/server.py:12`。\n### 结构\n`request.app` 指向处理本次请求的应用。`state.run_service` 保存启动时创建的服务对象，不是每次请求都新建。\n```python\napp.state.run_service = service\n```\n### 用法\n启动时，项目先创建 `service`，再把它保存到应用的 `state`。处理请求时，这条访问链取回同一个服务对象。\n**记住：** 属性名可以由项目选择，对象的创建和保存位置需要查当前代码。' }] };
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
    await page.locator('#question').fill('run_service 这个名字能改吗？');
    await page.locator('#send').click();
    const ask = await page.evaluate(() => window.sent.find(m => m.type === 'ask'));
    assert.ok(ask.quote.includes('run_service')); assert.equal(ask.text, 'run_service 这个名字能改吗？');
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
    fixture.messages[1].text = '### 来源\n这是项目自定义的函数。\n### 结构\n参数是字符串。\n### 用法\n接收输入并返回结果。';
    await page.evaluate(data => window.postMessage(data, '*'), fixture);
    await page.setViewportSize({ width: 480, height: 760 });
    await page.locator('#settings-toggle').click();
    const settings = await page.locator('#settings').boundingBox();
    assert.ok(settings.x >= 0 && settings.x + settings.width <= 480);
    await page.screenshot({ path: path.join(directory, 'ui-narrow.png') });
    assert.deepEqual(errors, []);
    console.log('PASS: 真实浏览器中的引用追问、快速模式、保存事件、四角缩放、窄屏布局与输出转义。');
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
