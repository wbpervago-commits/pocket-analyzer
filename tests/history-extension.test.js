'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const content = fs.readFileSync(path.join(root, 'extension', 'content.js'), 'utf8');
const pageHook = fs.readFileSync(path.join(root, 'extension', 'page-hook.js'), 'utf8');
const background = fs.readFileSync(path.join(root, 'extension', 'background.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'extension', 'manifest.json'), 'utf8'));

assert.equal(manifest.version, '0.3.2', 'History Experiment version should be 0.3.2');
assert.ok(content.includes('history-bridge-ping'), 'Analyzer content script must answer the bridge version handshake');
assert.ok(content.includes('history-bridge-ready'), 'Analyzer content script must publish the installed extension version');
assert.ok(content.includes('purpose === "strategy" && Number(message.period) !== 60'),
  'A hidden strategy archive must be accepted as M1 even when the visible chart uses M2/M5');
assert.ok(content.includes('purpose: event.data.purpose === "strategy" ? "strategy" : "chart"'),
  'The analyzer must label history requests and responses with their purpose');
assert.ok(content.includes('purpose: event.data.purpose'), 'History status messages must preserve request purpose');
assert.ok(pageHook.includes('purpose: request.purpose === "strategy" ? "strategy" : "chart"'),
  'The page hook must retain the request purpose throughout pagination');
assert.ok(pageHook.includes('purpose: session.purpose'), 'The completed history payload must include its purpose');
assert.ok(pageHook.includes('activeHistorySession?.purpose'), 'Paginated status messages must retain their session purpose');
assert.ok(background.includes('purpose: message.purpose === "strategy" ? "strategy" : "chart"'),
  'The background worker must forward the purpose back to the analyzer');

for (const [name, source] of [
  ['content.js', content],
  ['page-hook.js', pageHook],
  ['background.js', background]
]) {
  new vm.Script(source, { filename: name });
}

console.log('PASS: History Experiment purpose routing, version handshake, strategy M1 filtering, and syntax');
