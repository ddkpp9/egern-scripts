// Egern 今日黄历 Widget
// Real almanac data: https://api.timelessq.com/time
// Rewritten for ddkpp9/egern-scripts; no pseudo-random Yi/Ji data.

const API_URL = 'https://api.timelessq.com/time';
const CACHE_KEY = 'almanac-widget:cache-v2';
const WEEK = ['日', '一', '二', '三', '四', '五', '六'];

const C = {
  bg: { light: '#fffaf5', dark: '#12100f' },
  card: { light: '#fff1e6', dark: '#211b18' },
  border: { light: '#ead8ca', dark: '#46372f' },
  text: { light: '#241a16', dark: '#fff8f2' },
  muted: { light: '#75645b', dark: '#b8a79e' },
  dim: { light: '#a08e84', dark: '#806f66' },
  red: { light: '#c93636', dark: '#ff6b6b' },
  green: { light: '#28785d', dark: '#63d4ad' },
  gold: { light: '#a86b16', dark: '#f4bd62' },
};

export default async function (ctx) {
  const env = ctx.env || {};
  const showLunar = boolEnv(env.SHOW_LUNAR, true);
  const showYiJi = boolEnv(env.SHOW_YIJI, true);
  const showDetails = boolEnv(env.SHOW_DETAILS, true);
  const today = chinaDateParts();
  const dateKey = formatDateKey(today);
  const cached = readJSON(ctx, CACHE_KEY);
  let model;

  // Almanac data changes once per Beijing calendar day. Reuse today's cache
  // for every widget size/manual render and request the API only after rollover.
  if (cached && cached.dateKey === dateKey && cached.model) {
    model = cached.model;
  } else {
    try {
      const response = await ctx.http.get(`${API_URL}?datetime=${dateKey}`, {
        policy: 'DIRECT',
        timeout: 8000,
        credentials: 'omit',
        headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' },
      });
      if (response.status < 200 || response.status >= 300) {
        throw new Error(`黄历接口 HTTP ${response.status}`);
      }
      model = normalizeResponse(await response.json(), today);
      writeJSON(ctx, CACHE_KEY, { dateKey, at: Date.now(), model });
    } catch (error) {
      model = offlineModel(today, error);
    }
  }

  model.showLunar = showLunar;
  model.showYiJi = showYiJi;
  model.showDetails = showDetails;
  model.refreshAfter = nextChinaMidnight().toISOString();

  switch (ctx.widgetFamily) {
    case 'accessoryInline': return renderInline(model);
    case 'accessoryCircular': return renderCircular(model);
    case 'accessoryRectangular': return renderRectangular(model);
    case 'systemSmall': return renderSmall(model);
    case 'systemLarge':
    case 'systemExtraLarge': return renderLarge(model);
    case 'systemMedium':
    default: return renderMedium(model);
  }
}

function normalizeResponse(payload, fallbackDate) {
  if (!payload || payload.errno !== 0 || !payload.data) {
    throw new Error(String(payload && payload.errmsg || '黄历接口返回异常'));
  }

  const data = payload.data;
  const lunar = data.lunar || {};
  const almanac = data.almanac || {};
  if (!almanac.yi && !almanac.ji) throw new Error('黄历接口缺少宜忌数据');

  const festivals = [];
  for (const item of Array.isArray(data.festivals) ? data.festivals : []) {
    if (clean(item)) festivals.push(clean(item));
  }
  const solarTerms = lunar.solarTerms;
  if (typeof solarTerms === 'string' && clean(solarTerms)) festivals.push(clean(solarTerms));
  if (solarTerms && typeof solarTerms === 'object') {
    for (const value of Object.values(solarTerms)) {
      if (typeof value === 'string' && clean(value)) festivals.push(clean(value));
    }
  }

  return {
    year: numberOr(data.year, fallbackDate.year),
    month: numberOr(data.month, fallbackDate.month),
    day: numberOr(data.day, fallbackDate.day),
    week: clean(data.cnWeek) || `星期${WEEK[fallbackDate.weekday]}`,
    lunarText: [
      lunar.cyclicalYear ? `${lunar.cyclicalYear}年` : '',
      lunar.zodiac ? `${lunar.zodiac}年` : '',
      `${clean(lunar.cnMonth)}${clean(lunar.cnDay)}`,
    ].filter(Boolean).join(' · '),
    festivals: [...new Set(festivals)],
    yi: splitItems(almanac.yi),
    ji: splitItems(almanac.ji),
    chong: clean(almanac.chong),
    sha: clean(almanac.sha),
    nayin: clean(almanac.nayin),
    twelveGod: clean(almanac.shiershen),
    xingxiu: clean(almanac.xingxiu),
    pengzu: Array.isArray(almanac.pengzubaiji)
      ? almanac.pengzubaiji.map(clean).filter(Boolean)
      : splitItems(almanac.pengzubaiji),
    directions: almanac.jishenfangwei || {},
    source: 'TimelessQ / lunar-javascript',
  };
}

function offlineModel(date, error) {
  let lunarText = '农历暂不可用';
  try {
    lunarText = new Intl.DateTimeFormat('zh-CN-u-ca-chinese', {
      timeZone: 'Asia/Shanghai', year: 'numeric', month: 'long', day: 'numeric',
    }).format(new Date(Date.UTC(date.year, date.month - 1, date.day, 4)));
  } catch (_) { /* older runtimes may not provide the Chinese calendar */ }

  return {
    year: date.year, month: date.month, day: date.day,
    week: `星期${WEEK[date.weekday]}`,
    lunarText,
    festivals: [], yi: [], ji: [], chong: '', sha: '', nayin: '',
    twelveGod: '', xingxiu: '', pengzu: [], directions: {},
    warning: `黄历接口不可用：${messageOf(error)}`,
    offline: true,
  };
}

function chinaDateParts(now = Date.now()) {
  const date = new Date(now + 8 * 60 * 60 * 1000);
  return {
    year: date.getUTCFullYear(), month: date.getUTCMonth() + 1,
    day: date.getUTCDate(), weekday: date.getUTCDay(),
  };
}

function nextChinaMidnight(now = Date.now()) {
  const date = chinaDateParts(now);
  return new Date(Date.UTC(date.year, date.month - 1, date.day + 1, 0, 0) - 8 * 60 * 60 * 1000);
}

function formatDateKey(date) {
  return `${date.year}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;
}

function boolEnv(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  return !['0', 'false', 'no', 'off'].includes(String(value).trim().toLowerCase());
}

function numberOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clean(value) { return String(value == null ? '' : value).trim(); }
function messageOf(error) { return clean(error && (error.message || error)) || '未知错误'; }

function splitItems(value) {
  if (Array.isArray(value)) return value.map(clean).filter(Boolean);
  return clean(value).split(/[\s、，,。.;；]+/).map(clean).filter(Boolean);
}

function readJSON(ctx, key) {
  try { return ctx.storage && ctx.storage.getJSON(key); } catch (_) { return null; }
}

function writeJSON(ctx, key, value) {
  try { if (ctx.storage) ctx.storage.setJSON(key, value); } catch (_) { /* optional */ }
}

function txt(value, size = 'body', color = C.text, weight, options = {}) {
  return {
    type: 'text', text: clean(value), font: { size, ...(weight ? { weight } : {}) },
    textColor: color, maxLines: options.maxLines || 1, minScale: options.minScale || 0.7,
    ...(options.textAlign ? { textAlign: options.textAlign } : {}),
  };
}

function icon(symbol, color, size = 14) {
  return { type: 'image', src: `sf-symbol:${symbol}`, color, width: size, height: size };
}

function root(model, children, options = {}) {
  return {
    type: 'widget', backgroundColor: C.bg, padding: options.padding || 14,
    gap: options.gap == null ? 8 : options.gap,
    refreshAfter: model.refreshAfter, children,
  };
}

function header(model, compact = false) {
  return { type: 'stack', direction: 'row', alignItems: 'center', gap: 7, children: [
    icon('calendar', C.red, compact ? 15 : 18),
    txt('今日黄历', compact ? 'subheadline' : 'headline', C.text, 'bold'),
    { type: 'spacer' },
    ...(model.festivals.length ? [txt(model.festivals[0], 'caption2', C.gold, 'semibold')] : []),
  ] };
}

function dateBlock(model, compact = false) {
  return { type: 'stack', direction: 'column', gap: 2, children: [
    txt(`${model.month}月${model.day}日 ${model.week}`, compact ? 16 : 21, C.text, 'bold'),
    ...(model.showLunar ? [txt(model.lunarText, compact ? 'caption1' : 'subheadline', C.muted, 'medium')] : []),
  ] };
}

function activityRow(kind, values, compact = false) {
  const good = kind === '宜';
  const visible = values.slice(0, compact ? 5 : 10);
  return { type: 'stack', direction: 'row', alignItems: 'start', gap: 7, children: [
    { type: 'stack', padding: [2, 5], borderRadius: 5, backgroundColor: good ? C.red : C.green,
      children: [txt(kind, 'caption2', { light: '#ffffff', dark: '#101010' }, 'bold')] },
    txt(visible.length ? visible.join(' · ') : '暂无数据', compact ? 'caption2' : 'caption1', C.text, 'medium',
      { maxLines: compact ? 1 : 2, minScale: 0.6 }),
  ] };
}

function infoLine(model) {
  const items = [model.chong, model.sha, model.twelveGod, model.nayin].filter(Boolean);
  return txt(items.join(' · ') || '传统黄历仅供参考', 'caption2', C.muted, 'medium', { maxLines: 1 });
}

function warning(model) {
  return model.warning ? txt(model.warning, 'caption2', C.gold, 'medium', { maxLines: 2 }) : null;
}

function renderInline(model) {
  const label = model.showLunar && model.lunarText ? model.lunarText.split(' · ').pop() : `${model.month}月${model.day}日`;
  return root(model, [txt(`${label}${model.yi[0] ? ` · 宜 ${model.yi[0]}` : ''}`)] , { padding: 0, gap: 0 });
}

function renderCircular(model) {
  return root(model, [
    { type: 'spacer' }, txt(model.day, 24, C.red, 'bold', { textAlign: 'center' }),
    txt(model.showLunar ? model.lunarText.split(' · ').pop() : `${model.month}月`, 'caption2', C.muted, 'medium', { textAlign: 'center' }),
    { type: 'spacer' },
  ], { padding: 3, gap: 0 });
}

function renderRectangular(model) {
  return root(model, [
    txt(`${model.month}月${model.day}日 ${model.week}`, 'headline', C.text, 'bold'),
    ...(model.showLunar ? [txt(model.lunarText, 'caption2', C.muted)] : []),
    ...(model.showYiJi ? [txt(`宜 ${model.yi.slice(0, 4).join(' · ') || '暂无数据'}`, 'caption2', C.red)] : []),
  ], { padding: 6, gap: 1 });
}

function renderSmall(model) {
  return root(model, [
    header(model, true), dateBlock(model, true),
    ...(model.showYiJi ? [activityRow('宜', model.yi, true), activityRow('忌', model.ji, true)] : []),
    infoLine(model), ...(warning(model) ? [warning(model)] : []),
  ], { padding: 12, gap: 6 });
}

function renderMedium(model) {
  return root(model, [
    header(model), dateBlock(model),
    ...(model.showYiJi ? [activityRow('宜', model.yi), activityRow('忌', model.ji)] : []),
    { type: 'spacer' }, infoLine(model), ...(warning(model) ? [warning(model)] : []),
  ], { padding: 14, gap: 7 });
}

function renderLarge(model) {
  const direction = model.directions || {};
  const detailItems = [
    model.xingxiu && `星宿 ${model.xingxiu}`,
    direction.xi && `喜神 ${direction.xi}`,
    direction.cai && `财神 ${direction.cai}`,
  ].filter(Boolean);
  return root(model, [
    header(model), dateBlock(model),
    ...(model.showYiJi ? [activityRow('宜', model.yi), activityRow('忌', model.ji)] : []),
    { type: 'stack', height: 1, backgroundColor: C.border, children: [] },
    infoLine(model),
    ...(model.showDetails && detailItems.length ? [txt(detailItems.join(' · '), 'caption1', C.muted, 'medium', { maxLines: 2 })] : []),
    ...(model.showDetails && model.pengzu.length ? [
      txt(`彭祖百忌：${model.pengzu.join('；')}`, 'caption1', C.dim, undefined, { maxLines: 2 }),
    ] : []),
    { type: 'spacer' },
    txt(model.warning || '数据：TimelessQ · 传统民俗仅供参考', 'caption2', model.warning ? C.gold : C.dim),
  ], { padding: 16, gap: 9 });
}
