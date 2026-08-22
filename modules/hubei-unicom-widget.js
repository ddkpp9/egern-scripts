// 湖北联通 Egern Widget
// API and data model adapted from Honye/scripting-scripts.
// AUTHORIZATION is supplied manually through the module environment.

const API_BASE = 'https://wap.10010hb.net/zinfo/front/user';
const CACHE_KEY = 'hubei_unicom_widget_cache_v1';

const C = {
  bg: { light: '#f6f8fa', dark: '#0d1117' },
  card: { light: '#ffffff', dark: '#161b22' },
  border: { light: '#d0d7de', dark: '#30363d' },
  text: { light: '#1f2328', dark: '#f0f6fc' },
  muted: { light: '#57606a', dark: '#8b949e' },
  dim: { light: '#8c959f', dark: '#484f58' },
  accent: { light: '#0969da', dark: '#58a6ff' },
  flow: { light: '#0969da', dark: '#58a6ff' },
  voice: { light: '#1a7f37', dark: '#3fb950' },
  warn: { light: '#9a6700', dark: '#d29922' },
  error: { light: '#cf222e', dark: '#ff7b72' },
};

export default async function (ctx) {
  const env = ctx.env || {};
  const authorization = String(env.AUTHORIZATION || env.authorization || '').trim();
  const packageIds = String(env.PACKAGE_IDS || env.packageIds || '')
    .split(/[,，\s]+/).map(v => v.trim()).filter(Boolean);
  const refreshMinutes = boundedInt(env.REFRESH_MINUTES || env.refreshMinutes, 15, 5, 1440);

  let model;
  if (!authorization) {
    model = { error: '请在组件环境变量中填写 AUTHORIZATION' };
  } else {
    try {
      model = await loadAccount(ctx, authorization, packageIds);
      writeJSON(ctx, CACHE_KEY, { at: Date.now(), model });
    } catch (error) {
      const cached = readJSON(ctx, CACHE_KEY);
      if (cached && cached.model) {
        model = {
          ...cached.model,
          warning: `接口请求失败，正在显示缓存：${messageOf(error)}`,
          cachedAt: cached.at,
        };
      } else {
        model = { error: messageOf(error) };
      }
    }
  }

  model.refreshAfter = new Date(Date.now() + refreshMinutes * 60 * 1000).toISOString();

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

async function loadAccount(ctx, authorization, selectedIds) {
  const headers = {
    zx: '12',
    Authorization: authorization,
    Accept: '*/*',
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_2 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 MicroMessenger/8.0',
  };

  const [fee, packages] = await Promise.all([
    postJSON(ctx, `${API_BASE}/findFeePackage`, headers),
    postJSON(ctx, `${API_BASE}/findLeftPackage`, headers),
  ]);

  if (!fee || fee.success !== true) throw new Error(apiMessage(fee, '话费接口返回异常'));
  if (!packages || packages.success !== true) throw new Error(apiMessage(packages, '套餐接口返回异常'));

  const all = Array.isArray(packages.data && packages.data.addupInfoList)
    ? packages.data.addupInfoList : [];
  const selected = selectedIds.length
    ? all.filter(item => selectedIds.includes(String(item.FEE_POLICY_ID || '')))
    : all;

  const flow = aggregate(selected, '3');
  const voice = aggregate(selected, '1');
  const amount = Number(fee.data && fee.data.amount);

  return {
    balance: Number.isFinite(amount) ? amount : 0,
    flow,
    voice,
    packageCount: selected.length,
    updatedAt: new Date().toISOString(),
  };
}

async function postJSON(ctx, url, headers) {
  const response = await ctx.http.post(url, { headers, timeout: 8000 });
  if (response.status < 200 || response.status >= 300) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function apiMessage(payload, fallback) {
  return String(payload && (payload.message || payload.msg || payload.error) || fallback);
}

function aggregate(list, type) {
  let left = 0;
  let total = 0;
  let count = 0;
  for (const item of list) {
    if (String(item.ELEM_TYPE) !== type) continue;
    left += numberOf(item.X_CANUSE_VALUE);
    total += numberOf(item.ADDUP_UPPER);
    count += 1;
  }
  return { left, total, count, ratio: total > 0 ? clamp(left / total, 0, 1) : 0 };
}

function numberOf(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }

function boundedInt(value, fallback, min, max) {
  const number = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(number) ? clamp(number, min, max) : fallback;
}

function messageOf(error) { return String(error && (error.message || error) || '未知错误'); }

function readJSON(ctx, key) {
  try { return ctx.storage.getJSON(key); } catch (_) { return null; }
}

function writeJSON(ctx, key, value) {
  try { ctx.storage.setJSON(key, value); } catch (_) { /* cache is optional */ }
}

function fmtBalance(value) { return `¥${numberOf(value).toFixed(2)}`; }

function fmtFlow(mb) {
  const value = numberOf(mb);
  return value >= 1024 ? `${(value / 1024).toFixed(2)} GB` : `${value.toFixed(0)} MB`;
}

function fmtVoice(minutes) { return `${numberOf(minutes).toFixed(0)} 分钟`; }

function updatedText(model) {
  const date = new Date(model.cachedAt || model.updatedAt || Date.now());
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function widget(children, options = {}) {
  return { type: 'widget', backgroundColor: C.bg, padding: options.padding || 14,
    gap: options.gap || 8, refreshAfter: options.refreshAfter, children };
}

function text(value, size = 'body', color = C.text, weight) {
  return { type: 'text', text: String(value), font: { size, ...(weight ? { weight } : {}) },
    textColor: color, maxLines: 1, minScale: 0.65 };
}

function icon(name, color, size = 14) {
  return { type: 'image', src: `sf-symbol:${name}`, color, width: size, height: size };
}

function header(model) {
  return { type: 'stack', direction: 'row', alignItems: 'center', gap: 6, children: [
    icon('antenna.radiowaves.left.and.right', C.accent, 16),
    text('湖北联通', 'headline', C.text, 'bold'),
    { type: 'spacer' },
    text(updatedText(model), 'caption2', C.dim),
  ] };
}

function progress(value, color, height = 6) {
  const pct = Math.round(clamp(value, 0, 1) * 100);
  return { type: 'stack', direction: 'row', height, borderRadius: height / 2,
    backgroundColor: C.border, children: pct > 0 ? [
      { type: 'stack', flex: Math.max(1, pct), height, borderRadius: height / 2,
        backgroundColor: color, children: [] },
      ...(pct < 100 ? [{ type: 'spacer', flex: 100 - pct }] : []),
    ] : [{ type: 'spacer' }] };
}

function metric(title, value, ratio, color, symbol) {
  return { type: 'stack', direction: 'column', gap: 4, children: [
    { type: 'stack', direction: 'row', alignItems: 'center', gap: 5, children: [
      icon(symbol, color, 12), text(title, 'caption1', C.muted, 'semibold'),
      { type: 'spacer' }, text(value, 12, color, 'bold'),
    ] },
    progress(ratio, color),
  ] };
}

function errorWidget(model) {
  return widget([
    { type: 'stack', direction: 'row', alignItems: 'center', gap: 8, children: [
      icon('exclamationmark.triangle.fill', C.error, 18),
      text('湖北联通', 'headline', C.text, 'bold'),
    ] },
    text(model.error, 'caption1', C.muted),
  ], { padding: 14, refreshAfter: model.refreshAfter });
}

function renderInline(model) {
  if (model.error) return { type: 'widget', children: [text('湖北联通：认证或接口错误')] };
  return { type: 'widget', children: [text(`湖北联通 ${fmtBalance(model.balance)} · ${fmtFlow(model.flow.left)}`)] };
}

function renderCircular(model) {
  return { type: 'widget', padding: 4, children: model.error ? [
    { type: 'spacer' }, icon('exclamationmark', C.error, 18), { type: 'spacer' },
  ] : [
    { type: 'spacer' }, text(`${Math.round(model.flow.ratio * 100)}%`, 'title2', C.flow, 'bold'),
    text('流量', 'caption2', C.muted), { type: 'spacer' },
  ] };
}

function renderRectangular(model) {
  if (model.error) return { type: 'widget', children: [text('湖北联通', 'headline', C.text, 'bold'), text(model.error, 'caption2', C.muted)] };
  return { type: 'widget', gap: 2, children: [
    text(`话费 ${fmtBalance(model.balance)}`, 'headline', C.text, 'bold'),
    text(`流量 ${fmtFlow(model.flow.left)}  语音 ${fmtVoice(model.voice.left)}`, 11, C.muted),
  ] };
}

function renderSmall(model) {
  if (model.error) return errorWidget(model);
  return widget([
    header(model),
    text(fmtBalance(model.balance), 'title2', C.text, 'bold'),
    metric('剩余流量', fmtFlow(model.flow.left), model.flow.ratio, C.flow, 'antenna.radiowaves.left.and.right'),
    metric('剩余语音', fmtVoice(model.voice.left), model.voice.ratio, C.voice, 'phone.fill'),
    ...(model.warning ? [text('缓存数据', 'caption2', C.warn)] : []),
  ], { padding: 12, gap: 7, refreshAfter: model.refreshAfter });
}

function renderMedium(model) {
  if (model.error) return errorWidget(model);
  return widget([
    header(model),
    { type: 'stack', direction: 'row', alignItems: 'center', gap: 12, children: [
      { type: 'stack', direction: 'column', gap: 1, children: [
        text('剩余话费', 'caption1', C.muted), text(fmtBalance(model.balance), 'title2', C.text, 'bold'),
      ] },
      { type: 'spacer' },
      text(`${model.packageCount} 个套餐`, 'caption2', C.dim),
    ] },
    metric('剩余流量', fmtFlow(model.flow.left), model.flow.ratio, C.flow, 'antenna.radiowaves.left.and.right'),
    metric('剩余语音', fmtVoice(model.voice.left), model.voice.ratio, C.voice, 'phone.fill'),
    ...(model.warning ? [text('接口异常，显示上次缓存', 'caption2', C.warn)] : []),
  ], { refreshAfter: model.refreshAfter });
}

function renderLarge(model) {
  if (model.error) return errorWidget(model);
  return widget([
    header(model),
    { type: 'stack', direction: 'column', padding: 12, gap: 3, borderRadius: 12,
      backgroundColor: C.card, children: [
        text('剩余话费', 'caption1', C.muted), text(fmtBalance(model.balance), 'title1', C.text, 'bold'),
      ] },
    metric('剩余流量', fmtFlow(model.flow.left), model.flow.ratio, C.flow, 'antenna.radiowaves.left.and.right'),
    text(`总量 ${fmtFlow(model.flow.total)} · ${Math.round(model.flow.ratio * 100)}%`, 'caption2', C.dim),
    metric('剩余语音', fmtVoice(model.voice.left), model.voice.ratio, C.voice, 'phone.fill'),
    text(`总量 ${fmtVoice(model.voice.total)} · ${Math.round(model.voice.ratio * 100)}%`, 'caption2', C.dim),
    { type: 'spacer' },
    text(model.warning || `已统计 ${model.packageCount} 个套餐`, 'caption2', model.warning ? C.warn : C.dim),
  ], { refreshAfter: model.refreshAfter });
}
