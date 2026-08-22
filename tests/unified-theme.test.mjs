import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const files = [
  '../modules/almanac-widget.js',
  '../modules/network-ip-widget.js',
  '../modules/server-monitor.js',
  '../modules/hubei-unicom-widget.js',
  '../modules/calendar-weather-widget.js',
];

for (const relative of files) {
  const source = await fs.readFile(new URL(relative, import.meta.url), 'utf8');
  assert.match(source, /bg:\s*\{ light: '#f6f8fa', dark: '#0d1117' \}/, `${relative} background`);
  assert.match(source, /text:\s*\{ light: '#1f2328', dark: '#f0f6fc' \}/, `${relative} text`);
  assert.match(source, /muted:\s*\{ light: '#57606a', dark: '#8b949e' \}/, `${relative} muted text`);
  assert.doesNotMatch(source, /backgroundGradient:\s*(BG|bgGradient)/, `${relative} legacy gradient`);
}

console.log('unified-theme tests: ok');
