import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const source = await fs.readFile(new URL('../modules/hubei-unicom-widget.js', import.meta.url), 'utf8');
const module = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

const storage = new Map();
const ctx = {
  widgetFamily: 'systemMedium',
  env: { AUTHORIZATION: 'test-token', PACKAGE_IDS: 'flow-1,voice-1', REFRESH_MINUTES: '15' },
  storage: {
    getJSON(key) { return storage.get(key) || null; },
    setJSON(key, value) { storage.set(key, value); },
  },
  http: {
    async post(url, options) {
      assert.equal(options.headers.Authorization, 'test-token');
      if (url.endsWith('/findFeePackage')) return response({ success: true, data: { amount: '32.50' } });
      if (url.endsWith('/findLeftPackage')) return response({ success: true, data: { addupInfoList: [
        { FEE_POLICY_ID: 'flow-1', ELEM_TYPE: '3', X_CANUSE_VALUE: '2048', ADDUP_UPPER: '4096' },
        { FEE_POLICY_ID: 'voice-1', ELEM_TYPE: '1', X_CANUSE_VALUE: '120', ADDUP_UPPER: '300' },
        { FEE_POLICY_ID: 'ignored', ELEM_TYPE: '3', X_CANUSE_VALUE: '9999', ADDUP_UPPER: '9999' },
      ] } });
      throw new Error(`unexpected URL: ${url}`);
    },
  },
};

function response(body) { return { status: 200, async json() { return body; } }; }

function texts(node, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (node.type === 'text') out.push(String(node.text));
  for (const child of node.children || []) texts(child, out);
  return out;
}

const widget = await module.default(ctx);
const rendered = texts(widget).join('\n');
assert.equal(widget.type, 'widget');
assert.match(widget.refreshAfter, /^\d{4}-\d{2}-\d{2}T/);
assert.match(rendered, /¥32\.50/);
assert.match(rendered, /2\.00 GB/);
assert.match(rendered, /120 分钟/);
assert.doesNotMatch(rendered, /9\.76 GB/);

ctx.http.post = async () => { throw new Error('offline'); };
const cached = await module.default(ctx);
assert.match(texts(cached).join('\n'), /缓存/);

const missingAuth = await module.default({ ...ctx, env: {} });
assert.match(texts(missingAuth).join('\n'), /AUTHORIZATION/);

console.log('hubei-unicom-widget tests: ok');
