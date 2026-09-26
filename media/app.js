(() => {
  'use strict';
  const api = acquireVsCodeApi();
  const $ = id => document.getElementById(id);
  const post = (type, extra = {}) => api.postMessage({ type, ...extra });
  let state = { models: [], messages: [], busy: true };
  let quote = '';
  let selectedQuote = '';
  let settingsOpen = false;
  const effortNames = { none: 'None', minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Very high', max: 'Maximum', ultra: 'Ultra' };
  const escapeHtml = value => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  // Restricted Markdown: raw HTML, images, command URIs and remote links are never interpreted.
  function inline(text) {
    return text.split(/(`[^`]+`)/g).map(part => part.startsWith('`') && part.endsWith('`')
      ? `<code>${escapeHtml(part.slice(1, -1))}</code>`
      : escapeHtml(part).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')).join('');
  }
  function markdown(text) {
    let code = null;
    let output = '';
    for (const line of text.split('\n')) {
      if (/^\s*```/.test(line)) {
        if (code === null) code = [];
        else { output += `<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`; code = null; }
      } else if (code !== null) code.push(line);
      else if (/^#{1,6}\s/.test(line)) output += `<h3>${inline(line.replace(/^#{1,6}\s+/, ''))}</h3>`;
      else if (/^\s*[-*]\s/.test(line)) output += `<p>• ${inline(line.replace(/^\s*[-*]\s+/, ''))}</p>`;
      else if (/^>\s?/.test(line)) output += `<blockquote>${inline(line.replace(/^>\s?/, ''))}</blockquote>`;
      else if (line.trim()) output += `<p>${inline(line)}</p>`;
    }
    if (code !== null) output += `<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`;
    return output;
  }
  function renderMessages() {
    const container = $('conversation');
    const nearEnd = container.scrollHeight - container.scrollTop - container.clientHeight < 90;
    if (!state.messages.length) return;
    container.querySelector('.empty')?.remove();
    for (const message of state.messages) {
      let element = document.getElementById(message.id);
      if (!element) { element = document.createElement('article'); element.id = message.id; container.append(element); }
      element.className = `message ${message.role}${message.role === 'assistant' && !message.complete && !message.interrupted ? ' streaming' : ''}`;
      element.dataset.role = message.role;
      if (element.dataset.content !== message.text || element.dataset.interrupted !== String(!!message.interrupted)) {
        if (message.role === 'assistant') element.innerHTML = markdown(message.text) + (message.interrupted ? '<span class="partial">Answer incomplete; you can retry.</span>' : '');
        else element.textContent = message.text;
        element.dataset.content = message.text;
        element.dataset.interrupted = String(!!message.interrupted);
      }
    }
    if (nearEnd) container.scrollTop = container.scrollHeight;
  }
  function currentModel() { return state.models.find(m => m.model === $('model').value); }
  function supportsFast(model) { return model && ((model.serviceTiers || []).some(t => t.id === 'fast') || (model.additionalSpeedTiers || []).includes('fast')); }
  function updateEffort() {
    const model = currentModel();
    const choice = model?.supportedReasoningEfforts[Number($('effort').value)];
    $('effort-name').textContent = effortNames[choice?.reasoningEffort] || choice?.reasoningEffort || '';
    $('effort').setAttribute('aria-valuetext', $('effort-name').textContent);
    $('effort-description').textContent = choice?.description || '';
  }
  function renderSettings() {
    const model = state.models.find(m => m.model === state.settings?.model);
    $('model').replaceChildren(...state.models.map(m => { const option = document.createElement('option'); option.value = m.model; option.textContent = m.displayName || m.model; return option; }));
    $('model').value = state.settings?.model || '';
    const efforts = model?.supportedReasoningEfforts || [];
    $('effort').max = String(Math.max(0, efforts.length - 1));
    $('effort').value = String(Math.max(0, efforts.findIndex(e => e.reasoningEffort === state.settings?.effort)));
    $('effort-ticks').replaceChildren(...efforts.map(e => { const tick = document.createElement('span'); tick.textContent = effortNames[e.reasoningEffort] || e.reasoningEffort; return tick; }));
    updateEffort();
    $('fast').setAttribute('aria-checked', String(!!state.settings?.fast));
    $('fast').disabled = state.busy || !supportsFast(model);
    $('fast-description').textContent = supportsFast(model) ? (model.serviceTiers?.find(t => t.id === 'fast')?.description || "Uses Codex's fast service tier and may consume more quota.") : 'The current model does not advertise fast mode.';
    $('model').disabled = state.busy;
    $('effort').disabled = state.busy || efforts.length < 2;
    $('model-badge').textContent = model?.displayName || 'Codex';
    $('notes-path').textContent = state.notesPath || 'Choose a file on first save';
  }
  function placeSettings() {
    if (!settingsOpen) return;
    const box = $('window').getBoundingClientRect();
    const width = Math.min(265, innerWidth - 20);
    $('settings').style.width = width + 'px';
    let left = box.right + 10;
    if (left + width > innerWidth - 10) left = box.left - width - 10;
    if (left < 10) left = Math.max(10, box.right - width - 8);
    $('settings').style.left = left + 'px';
    $('settings').style.top = Math.max(10, Math.min(box.top, innerHeight - $('settings').offsetHeight - 10)) + 'px';
  }
  function toggleSettings(open) {
    settingsOpen = open;
    $('settings').hidden = !open;
    $('settings-toggle').setAttribute('aria-expanded', String(open));
    $('settings-toggle').classList.toggle('active', open);
    placeSettings();
    if (open) $('model').focus();
    else $('settings-toggle').focus();
  }
  function chooseSettings(extra) {
    const model = currentModel();
    if (!model) return;
    const effort = model.supportedReasoningEfforts[Number($('effort').value)]?.reasoningEffort || model.defaultReasoningEffort;
    post('settings', { settings: { model: model.model, effort, fast: supportsFast(model) && state.settings.fast, ...extra } });
  }
  window.addEventListener('message', ({ data }) => {
    if (data.type === 'state') {
      state = data;
      const source = state.source;
      $('source-name').textContent = `${source.file} : ${source.selection.startLine}–${source.selection.endLine}`;
      $('context-count').textContent = `${source.definitions.length} definitions`;
      $('context-content').textContent = JSON.stringify(source, null, 2);
      $('send').disabled = state.busy || !state.settings;
      $('save').disabled = state.busy || !state.messages.some(m => m.role === 'assistant' && m.complete);
      $('save').classList.toggle('active', !!state.saved);
      $('save').title = state.saved ? 'This explanation is saved' : 'Save short note';
      $('stop').hidden = !state.busy;
      $('retry').disabled = state.busy;
      $('status').textContent = state.busy ? 'Codex is working…' : state.saved ? 'Short note saved · You can keep asking' : 'Select explanation text to quote in a follow-up';
      renderSettings(); renderMessages(); placeSettings();
    } else if (data.type === 'delta') {
      const message = state.messages.find(m => m.id === data.id);
      if (message) { message.text = data.text; renderMessages(); }
    } else if (data.type === 'error') {
      $('error').hidden = false;
      $('retry').hidden = !data.canRetry;
      $('error').querySelector('span').textContent = data.text;
      $('status').textContent = '';
    } else if (data.type === 'notice') $('status').textContent = data.text;
  });
  $('settings-toggle').onclick = () => toggleSettings(!settingsOpen);
  $('settings-close').onclick = () => toggleSettings(false);
  $('model').onchange = () => { const model = currentModel(); chooseSettings({ effort: model.defaultReasoningEffort, fast: !!state.settings.fast && supportsFast(model) }); };
  $('effort').oninput = updateEffort;
  $('effort').onchange = () => chooseSettings({});
  $('fast').onclick = () => chooseSettings({ fast: !state.settings.fast });
  $('open-settings').onclick = () => post('openSettings');
  $('save').onclick = () => { $('error').hidden = true; post('save'); };
  $('source').onclick = () => post('source');
  $('stop').onclick = () => post('cancel');
  $('retry').onclick = () => { $('error').hidden = true; post('retry'); };
  $('context-toggle').onclick = () => { $('context').open = !$('context').open; $('context-toggle').setAttribute('aria-expanded', String($('context').open)); };
  function setQuote(text) { quote = text; $('quote-text').textContent = text; $('quote-chip').hidden = !text; }
  $('clear-quote').onclick = () => setQuote('');
  $('composer').onsubmit = event => {
    event.preventDefault();
    const text = $('question').value.trim();
    if (!text || state.busy || !state.settings) return;
    post('ask', { text, quote });
    $('question').value = ''; setQuote(''); $('error').hidden = true;
  };
  $('question').addEventListener('keydown', event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.isComposing) { event.preventDefault(); $('composer').requestSubmit(); } });
  function selectionQuote() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return '';
    const ancestor = selection.getRangeAt(0).commonAncestorContainer;
    const element = ancestor.nodeType === Node.ELEMENT_NODE ? ancestor : ancestor.parentElement;
    return element?.closest('.message.assistant') ? selection.toString().trim().slice(0, 12000) : '';
  }
  function showQuoteButton() {
    selectedQuote = selectionQuote();
    $('quote-action').hidden = !selectedQuote;
    if (selectedQuote) {
      const box = window.getSelection().getRangeAt(0).getBoundingClientRect();
      $('quote-action').style.left = Math.max(8, Math.min(innerWidth - 125, box.left)) + 'px';
      $('quote-action').style.top = Math.max(8, Math.min(innerHeight - 40, box.bottom + 5)) + 'px';
    }
  }
  $('conversation').addEventListener('mouseup', showQuoteButton);
  $('conversation').addEventListener('keyup', showQuoteButton);
  $('conversation').addEventListener('contextmenu', event => { if (selectionQuote()) { event.preventDefault(); showQuoteButton(); } });
  $('conversation').addEventListener('scroll', () => { $('quote-action').hidden = true; });
  $('quote-action').onmousedown = event => event.preventDefault();
  $('quote-action').onclick = () => { setQuote(selectedQuote); $('quote-action').hidden = true; window.getSelection().removeAllRanges(); $('question').focus(); };
  document.addEventListener('keydown', event => { if (event.key === 'Escape') { if (settingsOpen) toggleSettings(false); $('quote-action').hidden = true; } });
  const frame = $('window');
  function constrain(rect) {
    const width = Math.min(innerWidth - 16, Math.max(Math.min(340, innerWidth - 16), rect.width));
    const height = Math.min(innerHeight - 24, Math.max(Math.min(360, innerHeight - 24), rect.height));
    return { width, height, left: Math.max(8, Math.min(innerWidth - width - 8, rect.left)), top: Math.max(8, Math.min(innerHeight - height - 8, rect.top)) };
  }
  function applyRect(rect) { for (const key of ['left', 'top', 'width', 'height']) frame.style[key] = rect[key] + 'px'; placeSettings(); }
  function startDrag(event, corner) {
    if (event.button !== 0 || (!corner && event.target.closest('button'))) return;
    event.preventDefault();
    const box = frame.getBoundingClientRect();
    const start = { x: event.clientX, y: event.clientY };
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    function move(e) {
      const dx = e.clientX - start.x, dy = e.clientY - start.y;
      let { left, top, width, height } = box;
      if (!corner) { left += dx; top += dy; }
      else {
        if (corner.includes('e')) width += dx;
        if (corner.includes('s')) height += dy;
        if (corner.includes('w')) { width -= dx; left += dx; }
        if (corner.includes('n')) { height -= dy; top += dy; }
      }
      applyRect(constrain({ left, top, width, height }));
    }
    function end() { target.removeEventListener('pointermove', move); target.removeEventListener('pointerup', end); target.removeEventListener('pointercancel', end); const r = frame.getBoundingClientRect(); api.setState({ rect: { left: r.left, top: r.top, width: r.width, height: r.height } }); }
    target.addEventListener('pointermove', move); target.addEventListener('pointerup', end); target.addEventListener('pointercancel', end);
  }
  $('dragbar').addEventListener('pointerdown', e => startDrag(e, null));
  document.querySelectorAll('.resize').forEach(handle => handle.addEventListener('pointerdown', e => startDrag(e, handle.dataset.corner)));
  window.addEventListener('resize', () => applyRect(constrain(frame.getBoundingClientRect())));
  const previous = api.getState();
  if (previous?.rect) applyRect(constrain(previous.rect));
  post('ready');
})();
