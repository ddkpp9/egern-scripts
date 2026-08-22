import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const source = await fs.readFile(new URL('../modules/network-ip-widget.js', import.meta.url), 'utf8');
const widgetModule = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

function makeContext({ family = 'systemMedium', proxy6 = false, proxyPolicy = '策略选择', refreshMinutes = '60' } = {}) {
  const calls = [];
  const storage = new Map();

  const geo = {
    '223.5.5.5': {
      country_code: 'CN', country: '中国', region: '浙江省', city: '杭州市',
      connection: { asn: 45102, isp: '中国电信' },
    },
    '2400:3200::1': {
      country_code: 'CN', country: '中国', region: '浙江省', city: '杭州市',
      connection: { asn: 45102, isp: '中国电信' },
    },
    '8.8.8.8': {
      country_code: 'US', country: '美国', region: '加利福尼亚州', city: '山景城',
      connection: { asn: 15169, isp: 'Google LLC' },
    },
    '2001:4860:4860::8888': {
      country_code: 'US', country: '美国', region: '加利福尼亚州', city: '山景城',
      connection: { asn: 15169, isp: 'Google LLC' },
    },
  };

  const ctx = {
    widgetFamily: family,
    env: { proxyPolicy, refreshMinutes },
    device: {
      wifi: { ssid: 'Home-5G', bssid: '00:00:00:00:00:00' },
      cellular: { carrier: '中国移动', radio: 'NRNSA' },
      ipv4: { address: '192.168.50.23', interface: 'en0', gateway: '192.168.50.1' },
      ipv6: { address: '240e:1234::23', interface: 'en0' },
    },
    storage: {
      getJSON(key) { return storage.has(key) ? storage.get(key) : null; },
      setJSON(key, value) { storage.set(key, value); },
    },
    lookupIP(ip) {
      if (ip === '8.8.8.8') return { country: 'US', asn: 15169, organization: 'Google LLC' };
      return { country: 'CN', asn: 45102, organization: 'China Telecom' };
    },
    http: {
      async get(url, options = {}) {
        calls.push({ url, options });

        if (url.startsWith('https://ipwho.is/')) {
          const encoded = url.slice('https://ipwho.is/'.length).split('?')[0];
          const ip = decodeURIComponent(encoded);
          return responseJSON({ success: true, ip, ...geo[ip] });
        }

        if (url.includes('/geoip/')) {
          throw new Error('fallback should not be needed');
        }

        const direct = options.policy === 'DIRECT';
        if (url.includes('api-ipv4.ip.sb') || url.includes('api4.ipify.org')) {
          return responseText(direct ? '223.5.5.5\n' : '8.8.8.8\n');
        }
        if (url.includes('api-ipv6.ip.sb') || url.includes('api6.ipify.org')) {
          if (direct) return responseText('2400:3200::1\n');
          if (proxy6) return responseText('2001:4860:4860::8888\n');
          throw new Error('IPv6 network unreachable');
        }
        throw new Error(`unexpected URL: ${url}`);
      },
    },
  };

  return { ctx, calls };
}

function responseText(body) {
  return { status: 200, async text() { return body; } };
}

function responseJSON(body) {
  return { status: 200, async json() { return body; } };
}

function allText(node, output = []) {
  if (!node || typeof node !== 'object') return output;
  if (node.type === 'text') output.push(node.text);
  for (const child of node.children || []) allText(child, output);
  return output;
}

{
  const { ctx, calls } = makeContext();
  const widget = await widgetModule.default(ctx);
  const text = allText(widget).join('\n');

  assert.equal(widget.type, 'widget');
  assert.match(widget.refreshAfter, /^\d{4}-\d{2}-\d{2}T/);
  assert.match(text, /Home-5G/);
  assert.match(text, /192\.168\.50\.23/);
  assert.doesNotMatch(text, /240e:1234::23/);
  assert.match(text, /223\.5\.5\.5/);
  assert.match(text, /2400:3200::1/);
  assert.match(text, /8\.8\.8\.8/);
  assert.doesNotMatch(text, /2001:4860:4860::8888/);
  assert.match(text, /中国 · 浙江省 · 杭州市/);
  assert.match(text, /美国 · 加利福尼亚州 · 山景城/);

  const directProbe = calls.find(call => call.url.includes('api-ipv4.ip.sb') && call.options.policy === 'DIRECT');
  const proxyProbe = calls.find(call => call.url.includes('api-ipv4.ip.sb') && call.options.policy === '策略选择');
  assert.ok(directProbe, 'DIRECT probe must force the DIRECT policy');
  assert.ok(proxyProbe, 'proxy probe must force the configured policy group');
}

{
  const { ctx, calls } = makeContext({ family: null, proxy6: true });
  const networkResult = await widgetModule.default(ctx);
  assert.equal(networkResult, undefined, 'network-change run should only warm the cache');
  const afterPrefetch = calls.length;

  ctx.widgetFamily = 'systemMedium';
  const cachedWidget = await widgetModule.default(ctx);
  assert.equal(calls.length, afterPrefetch, 'first widget run after a network change should use the warmed snapshot');
  assert.match(allText(cachedWidget).join('\n'), /2001:4860:4860::8888/);

  await widgetModule.default(ctx);
  assert.ok(calls.length > afterPrefetch, 'a manual refresh on the same network should probe the current policy again');
}

{
  const { ctx } = makeContext({ family: 'systemLarge', proxy6: true });
  const widget = await widgetModule.default(ctx);
  assert.match(allText(widget).join('\n'), /2001:4860:4860::8888/);
}

for (const family of [
  'systemSmall',
  'systemMedium',
  'systemLarge',
  'systemExtraLarge',
  'accessoryInline',
  'accessoryCircular',
  'accessoryRectangular',
]) {
  const { ctx } = makeContext({ family, proxy6: true, proxyPolicy: '' });
  const widget = await widgetModule.default(ctx);
  assert.equal(widget.type, 'widget', `${family} should render a widget root`);
  assert.ok(widget.refreshAfter, `${family} should request a refresh`);
}

console.log('network-ip-widget tests: ok');
