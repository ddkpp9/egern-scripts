import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const source = await fs.readFile(new URL('../modules/calendar-weather-widget.js', import.meta.url), 'utf8');
const module = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const storage = new Map();
const calls = [];

const forecast = {
  current: { time: '2026-08-22T10:44', temperature_2m: 32, relative_humidity_2m: 73,
    apparent_temperature: 36, weather_code: 1, wind_speed_10m: 8, wind_direction_10m: 10, uv_index: 3.2 },
  daily: { time: ['2026-08-22', '2026-08-23', '2026-08-24'], weather_code: [1, 61, 2],
    temperature_2m_max: [35, 33, 34], temperature_2m_min: [28, 28, 28],
    sunrise: ['2026-08-22T05:53', '2026-08-23T05:54', '2026-08-24T05:54'],
    sunset: ['2026-08-22T18:57', '2026-08-23T18:56', '2026-08-24T18:55'],
    uv_index_max: [7, 6, 6], precipitation_probability_max: [10, 80, 20] },
};

const ctx = {
  widgetFamily: 'systemMedium',
  env: { CITY: '武汉', LOCATION_LABEL: '湖北 · 武汉 · 高新六路', REFRESH_MINUTES: '60' },
  storage: { getJSON(key) { return storage.get(key) || null; }, setJSON(key, value) { storage.set(key, value); } },
  http: { async get(url, options) {
    calls.push({ url, options });
    if (url.includes('geocoding-api')) return { status: 200, async json() { return { results: [{ latitude: 30.59, longitude: 114.31, name: '武汉', admin1: '湖北' }] }; } };
    if (url.includes('air-quality-api')) return { status: 200, async json() { return { current: { us_aqi: 42 } }; } };
    return { status: 200, async json() { return forecast; } };
  } },
};

function allText(node, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (node.type === 'text') out.push(String(node.text));
  for (const child of node.children || []) allText(child, out);
  return out;
}

for (const family of ['systemSmall', 'systemMedium', 'systemLarge', 'systemExtraLarge',
  'accessoryInline', 'accessoryCircular', 'accessoryRectangular']) {
  ctx.widgetFamily = family;
  const widget = await module.default(ctx);
  assert.equal(widget.type, 'widget', family);
  assert.match(widget.refreshAfter, /^\d{4}-\d{2}-\d{2}T/);
}
assert.equal(calls.length, 3, 'geocoding, forecast and air quality should be requested only once during cache TTL');

ctx.widgetFamily = 'systemMedium';
const widget = await module.default(ctx);
const text = allText(widget).join('\n');
assert.match(text, /湖北 · 武汉 · 高新六路/);
assert.match(text, /32°C/);
assert.match(text, /湿度 73%/);
assert.match(text, /空气 优/);
assert.match(text, /明天/);
assert.ok(calls.every(call => call.options.policy === 'DIRECT'));

ctx.http.get = async () => { throw new Error('cache should prevent requests'); };
await module.default(ctx);
assert.equal(calls.length, 3);

storage.clear();
ctx.env = { CITY: '不存在的城市' };
ctx.http.get = async () => { throw new Error('offline'); };
const offline = await module.default(ctx);
assert.match(allText(offline).join('\n'), /天气不可用|无法获取天气/);

console.log('calendar-weather-widget tests: ok');
