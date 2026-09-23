'use strict';
// Model content never shares the trusted command bar. Disable model-created links and images.
function safeMarkdown(text) {
  return text.split(/(```[\s\S]*?(?:```|$)|`[^`\n]+`)/g).map((part, index) => index % 2 ? part : part.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\[/g, '&#91;').replace(/\]/g, '&#93;')).join('');
}
function commandLink(label, command, id) {
  return `[${label}](command:${command}?${encodeURIComponent(JSON.stringify([id]))})`;
}
function quoteChoices(messages) {
  const options = [];
  for (const message of messages.filter(m => m.role === 'assistant' && m.complete)) {
    for (const text of message.text.split(/\n\s*\n/).map(s => s.trim()).filter(Boolean)) {
      options.push({ label: text.replace(/[#*`\r\n]/g, ' ').slice(0, 110), description: `第 ${options.length + 1} 段`, detail: text.slice(0, 350), quote: text });
    }
  }
  return options;
}
function completedMessages(messages) {
  return messages.filter((m, i) => m.complete && (m.role === 'assistant' || messages[i + 1]?.role === 'assistant' && messages[i + 1].complete));
}
module.exports = { safeMarkdown, commandLink, quoteChoices, completedMessages };
