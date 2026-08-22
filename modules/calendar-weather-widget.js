// Egern 天气日历 Widget
// Weather/geocoding/air quality: Open-Meteo (no API key required).

const CACHE_KEY = 'calendar-weather-widget:weather-v1';
const GEO_CACHE_KEY = 'calendar-weather-widget:geocode-v1';
const TZ = 'Asia/Shanghai';
const WEEK = ['日', '一', '二', '三', '四', '五', '六'];

const C = {
  bg: { light: '#f6f8fa', dark: '#0d1117' },
  clear: { light: '#00000000', dark: '#00000000' },
  glass: { light: '#ffffff38', dark: '#0d111766' },
  glassBorder: { light: '#ffffff8f', dark: '#ffffff42' },
  card: { light: '#ffffff', dark: '#161b22' },
  border: { light: '#d0d7de', dark: '#30363d' },
  text: { light: '#1f2328', dark: '#f0f6fc' },
  muted: { light: '#57606a', dark: '#8b949e' },
  dim: { light: '#8c959f', dark: '#484f58' },
  accent: { light: '#0969da', dark: '#58a6ff' },
  success: { light: '#1a7f37', dark: '#3fb950' },
  danger: { light: '#cf222e', dark: '#ff7b72' },
  warn: { light: '#9a6700', dark: '#d29922' },
};

export default async function (ctx) {
  const env = ctx.env || {};
  const refreshMinutes = clamp(numberEnv(env.REFRESH_MINUTES, 60), 30, 360);
  const config = {
    city: clean(env.CITY),
    locationLabel: clean(env.LOCATION_LABEL),
    latitude: finiteOrNull(env.LATITUDE),
    longitude: finiteOrNull(env.LONGITUDE),
    refreshMinutes,
  };

  let model;
  try {
    model = await loadModel(ctx, config);
  } catch (error) {
    model = fallbackModel(ctx, config, error);
  }
  model.calendar = calendarModel();
  model.events = upcomingEvents(new Date(), 3);
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

async function loadModel(ctx, config) {
  const location = await resolveLocation(ctx, config);
  const locationKey = `${location.latitude.toFixed(3)},${location.longitude.toFixed(3)}`;
  const cached = readJSON(ctx, CACHE_KEY);
  const maxAge = config.refreshMinutes * 60 * 1000;
  if (cached && cached.locationKey === locationKey && cached.model && Date.now() - cached.at < maxAge) {
    return { ...cached.model, locationLabel: config.locationLabel || cached.model.locationLabel };
  }

  const forecastURL = 'https://api.open-meteo.com/v1/forecast?' + query({
    latitude: location.latitude,
    longitude: location.longitude,
    current: 'temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m,uv_index',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,uv_index_max,precipitation_probability_max',
    timezone: TZ,
    forecast_days: 3,
  });
  const airURL = 'https://air-quality-api.open-meteo.com/v1/air-quality?' + query({
    latitude: location.latitude,
    longitude: location.longitude,
    current: 'us_aqi',
    timezone: TZ,
  });

  try {
    const [forecastResponse, airResponse] = await Promise.all([
      ctx.http.get(forecastURL, requestOptions()),
      ctx.http.get(airURL, requestOptions()),
    ]);
    if (!ok(forecastResponse)) throw new Error(`天气接口 HTTP ${forecastResponse.status}`);
    const forecast = await forecastResponse.json();
    const air = ok(airResponse) ? await airResponse.json() : {};
    const model = normalizeWeather(forecast, air, location, config.locationLabel);
    writeJSON(ctx, CACHE_KEY, { at: Date.now(), locationKey, model });
    return model;
  } catch (error) {
    if (cached && cached.locationKey === locationKey && cached.model) {
      return {
        ...cached.model,
        locationLabel: config.locationLabel || cached.model.locationLabel,
        warning: `天气更新失败，显示上次数据：${messageOf(error)}`,
      };
    }
    throw error;
  }
}

async function resolveLocation(ctx, config) {
  if (config.latitude !== null && config.longitude !== null) {
    return { latitude: config.latitude, longitude: config.longitude, name: config.city || '自定义位置', admin1: '' };
  }
  if (!config.city) throw new Error('请填写城市，或同时填写纬度和经度');
  const cached = readJSON(ctx, GEO_CACHE_KEY);
  if (cached && cached.city === config.city && cached.location && Date.now() - cached.at < 30 * 86400000) {
    return cached.location;
  }
  const url = 'https://geocoding-api.open-meteo.com/v1/search?' + query({
    name: config.city, count: 1, language: 'zh', format: 'json', countryCode: 'CN',
  });
  const response = await ctx.http.get(url, requestOptions());
  if (!ok(response)) throw new Error(`城市查询 HTTP ${response.status}`);
  const payload = await response.json();
  const item = payload && Array.isArray(payload.results) && payload.results[0];
  if (!item || !Number.isFinite(Number(item.latitude)) || !Number.isFinite(Number(item.longitude))) {
    throw new Error(`找不到城市“${config.city}”`);
  }
  const location = {
    latitude: Number(item.latitude), longitude: Number(item.longitude),
    name: clean(item.name) || config.city, admin1: clean(item.admin1),
  };
  writeJSON(ctx, GEO_CACHE_KEY, { at: Date.now(), city: config.city, location });
  return location;
}

function normalizeWeather(payload, air, location, customLabel) {
  const current = payload && payload.current;
  const daily = payload && payload.daily;
  if (!current || !daily || !Array.isArray(daily.time) || daily.time.length < 1) {
    throw new Error('天气接口缺少必要数据');
  }
  const days = daily.time.slice(0, 3).map((date, index) => ({
    date,
    code: numberEnv(daily.weather_code && daily.weather_code[index], 0),
    high: round(daily.temperature_2m_max && daily.temperature_2m_max[index]),
    low: round(daily.temperature_2m_min && daily.temperature_2m_min[index]),
    sunrise: timeOnly(daily.sunrise && daily.sunrise[index]),
    sunset: timeOnly(daily.sunset && daily.sunset[index]),
    precipitation: round(daily.precipitation_probability_max && daily.precipitation_probability_max[index]),
  }));
  const weather = weatherInfo(current.weather_code);
  const aqi = round(air && air.current && air.current.us_aqi);
  const label = customLabel || [location.admin1, location.name].filter(Boolean).join(' · ') || location.name;
  return {
    locationLabel: label,
    temperature: round(current.temperature_2m),
    apparent: round(current.apparent_temperature),
    humidity: round(current.relative_humidity_2m),
    windSpeed: round(current.wind_speed_10m),
    windDirection: windDirection(current.wind_direction_10m),
    uv: oneDecimal(current.uv_index),
    aqi,
    weather,
    days,
    summary: forecastSummary(days),
    updatedAt: timeOnly(current.time) || beijingTime(),
  };
}

function fallbackModel(ctx, config, error) {
  const cached = readJSON(ctx, CACHE_KEY);
  if (cached && cached.model) {
    return { ...cached.model, locationLabel: config.locationLabel || cached.model.locationLabel,
      warning: `天气更新失败，显示上次数据：${messageOf(error)}` };
  }
  return {
    locationLabel: config.locationLabel || config.city || '未设置位置',
    temperature: '--', apparent: '--', humidity: '--', windSpeed: '--', windDirection: '--',
    uv: '--', aqi: null, weather: { text: '天气不可用', symbol: 'exclamationmark.triangle.fill' },
    days: [], summary: `暂时无法获取天气：${messageOf(error)}`, updatedAt: beijingTime(), warning: messageOf(error),
  };
}

function calendarModel(now = new Date()) {
  const parts = chinaParts(now);
  return {
    ...parts,
    weekText: `星期${WEEK[parts.weekday]}`,
    lunar: lunarText(now),
  };
}

function chinaParts(date) {
  const shifted = new Date(date.getTime() + 8 * 3600000);
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(), weekday: shifted.getUTCDay() };
}

function lunarText(date) {
  try {
    const parts = new Intl.DateTimeFormat('zh-CN-u-ca-chinese', {
      timeZone: TZ, month: 'long', day: 'numeric',
    }).formatToParts(date);
    const month = clean((parts.find(item => item.type === 'month') || {}).value);
    const day = Number((parts.find(item => item.type === 'day') || {}).value);
    return `${month}${lunarDayText(day)}`;
  } catch (_) { return '农历暂不可用'; }
}

function lunarDayText(day) {
  const digits = ['日', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
  if (day <= 10) return `初${digits[day]}`;
  if (day < 20) return `十${day === 10 ? '' : digits[day - 10]}`;
  if (day === 20) return '二十';
  if (day < 30) return `廿${digits[day - 20]}`;
  return '三十';
}

function upcomingEvents(now, limit) {
  const today = chinaDateAtNoon(now);
  const year = today.getUTCFullYear();
  const events = [];
  const solar = [[1, 1, '元旦', 'sparkles'], [5, 1, '劳动节', 'heart.fill'], [10, 1, '国庆节', 'heart.fill']];
  for (const y of [year, year + 1]) {
    for (const [month, day, name, symbol] of solar) events.push(event(y, month, day, name, symbol));
    for (let i = 0; i < 24; i++) {
      const termDay = solarTermDay(y, i);
      events.push(event(y, Math.floor(i / 2) + 1, termDay, SOLAR_TERM_NAMES[i], 'sun.max.fill'));
    }
  }
  const lunarFestivals = new Map([
    ['1-1', ['春节', 'sparkles']], ['1-15', ['元宵节', 'moon.stars.fill']],
    ['5-5', ['端午节', 'leaf.fill']], ['7-7', ['七夕', 'heart.fill']],
    ['7-15', ['中元节', 'moon.fill']], ['8-15', ['中秋节', 'moon.stars.fill']],
    ['9-9', ['重阳节', 'mountain.2.fill']],
  ]);
  for (let offset = 0; offset <= 430; offset++) {
    const date = new Date(today.getTime() + offset * 86400000);
    const lunar = lunarParts(date);
    const item = lunarFestivals.get(`${lunar.month}-${lunar.day}`);
    if (item) events.push({ date, name: item[0], symbol: item[1] });
  }
  const seen = new Set();
  return events
    .filter(item => item.date >= today)
    .sort((a, b) => a.date - b.date)
    .filter(item => { const key = `${dateKey(item.date)}:${item.name}`; if (seen.has(key)) return false; seen.add(key); return true; })
    .slice(0, limit)
    .map(item => ({ ...item, days: Math.round((item.date - today) / 86400000) }));
}

function lunarParts(date) {
  try {
    const parts = new Intl.DateTimeFormat('zh-CN-u-ca-chinese', {
      timeZone: 'UTC', month: 'long', day: 'numeric',
    }).formatToParts(date);
    const rawMonth = clean((parts.find(item => item.type === 'month') || {}).value).replace('闰', '');
    const months = { 正月: 1, 二月: 2, 三月: 3, 四月: 4, 五月: 5, 六月: 6,
      七月: 7, 八月: 8, 九月: 9, 十月: 10, 冬月: 11, 腊月: 12, 十一月: 11, 十二月: 12 };
    return { month: months[rawMonth] || 0, day: Number((parts.find(item => item.type === 'day') || {}).value) };
  } catch (_) { return { month: 0, day: 0 }; }
}

const SOLAR_TERM_NAMES = ['小寒', '大寒', '立春', '雨水', '惊蛰', '春分', '清明', '谷雨', '立夏', '小满', '芒种', '夏至', '小暑', '大暑', '立秋', '处暑', '白露', '秋分', '寒露', '霜降', '立冬', '小雪', '大雪', '冬至'];
const SOLAR_TERM_INFO = [0, 21208, 42467, 63836, 85337, 107014, 128867, 150921, 173149, 195551, 218072, 240693, 263343, 285989, 308563, 331033, 353350, 375494, 397447, 419210, 440795, 462224, 483532, 504758];

function solarTermDay(year, index) {
  return new Date(31556925974.7 * (year - 1900) + SOLAR_TERM_INFO[index] * 60000 + Date.UTC(1900, 0, 6, 2, 5)).getUTCDate();
}

function event(year, month, day, name, symbol) {
  return { date: new Date(Date.UTC(year, month - 1, day, 4)), name, symbol };
}

function chinaDateAtNoon(now) {
  const p = chinaParts(now);
  return new Date(Date.UTC(p.year, p.month - 1, p.day, 4));
}

function dateKey(date) { return date.toISOString().slice(0, 10); }

function weatherInfo(code) {
  const value = Number(code);
  if (value === 0) return { text: '晴', symbol: 'sun.max.fill' };
  if (value <= 2) return { text: '多云', symbol: 'cloud.sun.fill' };
  if (value === 3) return { text: '阴', symbol: 'cloud.fill' };
  if (value === 45 || value === 48) return { text: '雾', symbol: 'cloud.fog.fill' };
  if (value >= 51 && value <= 57) return { text: '毛毛雨', symbol: 'cloud.drizzle.fill' };
  if ((value >= 61 && value <= 67) || (value >= 80 && value <= 82)) return { text: value >= 80 ? '阵雨' : '雨', symbol: 'cloud.rain.fill' };
  if ((value >= 71 && value <= 77) || (value >= 85 && value <= 86)) return { text: '雪', symbol: 'cloud.snow.fill' };
  if (value >= 95) return { text: '雷雨', symbol: 'cloud.bolt.rain.fill' };
  return { text: '天气', symbol: 'cloud.fill' };
}

function forecastSummary(days) {
  if (!days.length) return '暂无天气趋势';
  const labels = ['今天', '明天', '后天'];
  return days.map((day, index) => `${labels[index]}${weatherInfo(day.code).text}${day.precipitation > 40 ? `，降水概率${day.precipitation}%` : ''}`).join('；');
}

function windDirection(degrees) {
  const value = Number(degrees);
  if (!Number.isFinite(value)) return '--';
  const names = ['北风', '东北风', '东风', '东南风', '南风', '西南风', '西风', '西北风'];
  return names[Math.round((((value % 360) + 360) % 360) / 45) % 8];
}

function aqiText(value) {
  if (!Number.isFinite(Number(value))) return '--';
  if (value <= 50) return '优'; if (value <= 100) return '良'; if (value <= 150) return '轻度污染';
  if (value <= 200) return '中度污染'; if (value <= 300) return '重度污染'; return '严重污染';
}

function uvText(value) {
  if (!Number.isFinite(Number(value))) return '--';
  if (value < 3) return '弱'; if (value < 6) return '中等'; if (value < 8) return '强';
  if (value < 11) return '很强'; return '极强';
}

function beaufort(value) {
  const speed = Number(value);
  if (!Number.isFinite(speed)) return '--';
  const limits = [1, 6, 12, 20, 29, 39, 50, 62, 75, 89, 103, 118];
  const level = limits.findIndex(limit => speed < limit);
  return level < 0 ? 12 : level;
}

function root(model, children, padding = 12, gap = 6) {
  return {
    type: 'widget', backgroundColor: C.clear, padding: 1, gap: 0,
    refreshAfter: model.refreshAfter,
    children: [{
      type: 'stack', direction: 'column', flex: 1,
      backgroundColor: C.glass, borderColor: C.glassBorder,
      borderWidth: 1, borderRadius: 'auto', padding, gap, children,
    }],
  };
}

function txt(value, size = 'caption1', color = C.text, weight, options = {}) {
  return { type: 'text', text: clean(value), font: { size, ...(weight ? { weight } : {}) }, textColor: color,
    maxLines: options.maxLines || 1, minScale: options.minScale || 0.65,
    ...(options.textAlign ? { textAlign: options.textAlign } : {}) };
}

function icon(symbol, color = C.accent, size = 14) {
  return { type: 'image', src: `sf-symbol:${symbol}`, color, width: size, height: size };
}

function row(children, gap = 5, alignItems = 'center') {
  return { type: 'stack', direction: 'row', gap, alignItems, children };
}

function col(children, gap = 4) { return { type: 'stack', direction: 'column', gap, children }; }

function dateHeader(model, compact = false) {
  const d = model.calendar;
  return col([
    txt(`${d.year}/${d.month}/${d.day}/${d.weekText}/${d.lunar}`, compact ? 'caption1' : 'subheadline', C.accent, 'semibold', { minScale: 0.55 }),
    row([icon('location.fill', C.accent, compact ? 11 : 13), txt(model.locationLabel, compact ? 'caption2' : 'caption1', C.muted, 'medium')], 4),
  ], 2);
}

function currentBlock(model, compact = false) {
  return col([
    row([icon(model.weather.symbol, C.warn, compact ? 22 : 28), txt(`${model.temperature}°C`, compact ? 21 : 28, C.text, 'medium')], 7),
    detailLine('风力', `${model.windDirection} ${beaufort(model.windSpeed)}级`),
    detailLine('湿度', `${model.humidity}%`),
    detailLine('体感', `${model.apparent}°`),
    detailLine('紫外线', uvText(model.uv)),
    detailLine('空气', aqiText(model.aqi)),
  ], 2);
}

function detailLine(label, value) {
  return row([txt(label, 'caption2', C.muted, 'medium'), txt(value, 'caption2', C.text, 'medium')], 4, 'center');
}

function forecastBlock(model) {
  return row(model.days.slice(1, 3).map(day => col([
    txt(`${Number(clean(day.date).slice(-2)) || '--'}日`, 'caption1', C.text, 'semibold', { textAlign: 'center' }),
    icon(weatherInfo(day.code).symbol, C.text, 20),
    txt(`${day.low}/${day.high}°`, 'caption2', C.text, 'medium', { textAlign: 'center' }),
  ], 1)), 20, 'center');
}

function eventRows(model, limit = 3) {
  return model.events.slice(0, limit).map(item => row([
    icon(item.symbol, item.symbol.includes('moon') ? C.accent : C.warn, 11),
    txt(item.days === 0 ? `今天是${item.name}` : `距离${item.name}还有${item.days}天`, 'caption2', C.muted, 'medium'),
  ], 4));
}

function sunBlock(model) {
  const today = model.days[0] || {};
  return col([
    row([txt(`↑${today.high == null ? '--' : today.high}°`, 'caption1', C.danger, 'semibold'),
      txt(`↓${today.low == null ? '--' : today.low}°`, 'caption1', C.success, 'semibold')], 7),
    row([icon('sunrise.fill', C.warn, 14), txt(today.sunrise || '--', 'caption2', C.muted), icon('sunset.fill', C.danger, 14), txt(today.sunset || '--', 'caption2', C.muted)], 4),
    txt(`更新 ${model.updatedAt}`, 'caption2', C.dim, 'medium', { textAlign: 'right' }),
  ], 2);
}

function divider() { return { type: 'stack', height: 1, backgroundColor: C.border, children: [] }; }

function renderInline(model) {
  return root(model, [txt(`${model.calendar.month}/${model.calendar.day} ${model.weather.text} ${model.temperature}° · ${model.locationLabel}`)], 0, 0);
}

function renderCircular(model) {
  return root(model, [{ type: 'spacer' }, icon(model.weather.symbol, C.warn, 20),
    txt(`${model.temperature}°`, 18, C.text, 'bold', { textAlign: 'center' }), { type: 'spacer' }], 3, 0);
}

function renderRectangular(model) {
  return root(model, [row([
    col([txt(`${model.calendar.month}月${model.calendar.day}日 ${model.calendar.weekText}`, 'headline', C.text, 'bold'),
      txt(`${model.locationLabel} · ${model.weather.text}`, 'caption2', C.muted)], 2),
    { type: 'spacer' }, icon(model.weather.symbol, C.warn, 22), txt(`${model.temperature}°`, 20, C.text, 'semibold'),
  ])], 6, 1);
}

function renderSmall(model) {
  return root(model, [
    dateHeader(model, true), divider(),
    row([icon(model.weather.symbol, C.warn, 26), txt(`${model.temperature}°`, 26, C.text, 'bold'), { type: 'spacer' },
      col([txt(model.weather.text, 'caption1', C.text, 'semibold', { textAlign: 'right' }), txt(`${model.days[0] ? `${model.days[0].low}/${model.days[0].high}°` : '--'}`, 'caption2', C.muted, 'medium', { textAlign: 'right' })], 1)]),
    txt(`体感 ${model.apparent}° · 湿度 ${model.humidity}%`, 'caption2', C.muted, 'medium'),
    ...(eventRows(model, 2)),
    ...(model.warning ? [txt(model.warning, 'caption2', C.warn, 'medium', { maxLines: 2 })] : []),
  ], 11, 5);
}

function renderMedium(model) {
  const left = {
    ...col([
      dateHeader(model),
      forecastBlock(model),
      row([icon('speaker.wave.2.fill', C.muted, 11), txt(model.summary, 'caption2', C.text, 'medium', { maxLines: 1, minScale: 0.5 })], 4),
      divider(),
      ...eventRows(model, 3),
    ], 3),
    flex: 5, alignItems: 'start',
  };
  const right = {
    ...col([
      currentBlock(model),
      { type: 'spacer' },
      sunBlock(model),
      ...(model.warning ? [txt('显示缓存数据', 'caption2', C.warn, 'semibold', { textAlign: 'right' })] : []),
    ], 3),
    flex: 3, alignItems: 'end',
  };
  return root(model, [row([left, { type: 'spacer', length: 10 }, right], 0, 'start')], 11, 0);
}

function renderLarge(model) {
  const today = model.days[0] || {};
  return root(model, [
    row([dateHeader(model), { type: 'spacer' }, currentBlock(model)]), divider(),
    txt('未来天气', 'headline', C.text, 'bold'),
    ...model.days.map((day, index) => row([
      txt(['今天', '明天', '后天'][index], 'subheadline', C.text, 'semibold'),
      icon(weatherInfo(day.code).symbol, C.accent, 20), txt(weatherInfo(day.code).text, 'caption1', C.muted, 'medium'),
      { type: 'spacer' }, txt(`降水 ${day.precipitation}%`, 'caption2', C.muted),
      txt(`${day.low} / ${day.high}°`, 'subheadline', C.text, 'semibold'),
    ], 7)),
    txt(model.summary, 'caption1', C.muted, 'medium', { maxLines: 2 }), divider(),
    row([col([txt('近期节日与节气', 'headline', C.text, 'bold'), ...eventRows(model, 3)], 5),
      { type: 'spacer' }, col([txt('今日详情', 'headline', C.text, 'bold'),
        txt(`日出 ${today.sunrise || '--'} · 日落 ${today.sunset || '--'}`, 'caption1', C.muted),
        txt(`紫外线 ${model.uv} ${uvText(model.uv)} · AQI ${model.aqi == null ? '--' : model.aqi} ${aqiText(model.aqi)}`, 'caption1', C.muted),
        txt(`更新 ${model.updatedAt}`, 'caption2', C.dim)], 5)], 10, 'start'),
    ...(model.warning ? [txt(model.warning, 'caption2', C.warn, 'medium', { maxLines: 2 })] : []),
  ], 14, 7);
}

function query(values) {
  return Object.entries(values).map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join('&');
}
function requestOptions() { return { policy: 'DIRECT', timeout: 10000, credentials: 'omit', headers: { Accept: 'application/json' } }; }
function ok(response) { return response && response.status >= 200 && response.status < 300; }
function clean(value) { return String(value == null ? '' : value).trim(); }
function messageOf(error) { return clean(error && (error.message || error)) || '未知错误'; }
function numberEnv(value, fallback) { const number = Number(value); return Number.isFinite(number) ? number : fallback; }
function finiteOrNull(value) { if (value === undefined || value === null || clean(value) === '') return null; const number = Number(value); return Number.isFinite(number) ? number : null; }
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function round(value) { const number = Number(value); return Number.isFinite(number) ? Math.round(number) : '--'; }
function oneDecimal(value) { const number = Number(value); return Number.isFinite(number) ? Math.round(number * 10) / 10 : '--'; }
function timeOnly(value) { const match = clean(value).match(/T(\d{2}:\d{2})/); return match ? match[1] : ''; }
function beijingTime() { return new Intl.DateTimeFormat('zh-CN', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date()); }
function readJSON(ctx, key) { try { return ctx.storage && ctx.storage.getJSON(key); } catch (_) { return null; } }
function writeJSON(ctx, key, value) { try { if (ctx.storage) ctx.storage.setJSON(key, value); } catch (_) { /* storage is optional */ } }
