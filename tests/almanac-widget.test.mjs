import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const source = await fs.readFile(new URL('../modules/almanac-widget.js', import.meta.url), 'utf8');
const module = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const storage = new Map();
const calls = [];

const responseData = {
  errno: 0, errmsg: '', data: {
    year: 2026, month: 8, day: 22, cnWeek: '星期六', festivals: [],
    lunar: { zodiac: '马', cyclicalYear: '丙午', cnMonth: '七月', cnDay: '初十', solarTerms: {} },
    almanac: {
      yi: '祭祀 祈福 出行', ji: '动土 安葬', chong: '生肖冲鼠', sha: '煞北',
      nayin: '天河水', shiershen: '成神', xingxiu: '角宿',
      pengzubaiji: ['丙不修灶', '午不苫盖'],
      jishenfangwei: { xi: '西南', cai: '正西' },
    },
  },
};

const ctx = {
  widgetFamily: 'systemMedium',
  env: {},
  storage: {
    getJSON(key) { return storage.get(key) || null; },
    setJSON(key, value) { storage.set(key, value); },
  },
  http: {
    async get(url, options) {
      calls.push({ url, options });
      return { status: 200, async json() { return responseData; } };
    },
  },
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

ctx.widgetFamily = 'systemLarge';
const widget = await module.default(ctx);
const text = allText(widget).join('\n');
assert.match(text, /祭祀/);
assert.match(text, /动土/);
assert.match(text, /生肖冲鼠/);
assert.match(text, /彭祖百忌/);
assert.doesNotMatch(text, /★|幸运指数/);
assert.ok(calls.every(call => call.options.policy === 'DIRECT'));
assert.ok(calls.every(call => /datetime=\d{4}-\d{2}-\d{2}/.test(call.url)));

ctx.http.get = async () => { throw new Error('offline'); };
const cached = await module.default(ctx);
assert.match(allText(cached).join('\n'), /接口暂时不可用|黄历接口不可用/);

console.log('almanac-widget tests: ok');
