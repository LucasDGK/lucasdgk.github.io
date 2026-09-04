/**
 * Runs the worker against the live FPL API with an in-memory stand-in for KV, so
 * the logic can be checked without deploying.
 *
 *   node worker/test-local.mjs            # exercise cron + HTTP paths
 *   node worker/test-local.mjs --compare  # also diff against fetch_fpl.py output
 *
 * With --compare, run the Python script first so its output exists:
 *   python .github/scripts/fetch_fpl.py
 */

import worker from './fpl-worker.js';
import fs from 'node:fs';

const store = new Map();
const env = {
  FPL_KV: {
    async get(key, type) {
      const v = store.get(key);
      if (v === undefined) return null;
      return type === 'json' ? JSON.parse(v) : v;
    },
    async put(key, value) { store.set(key, value); },
  },
};

async function runCron() {
  const pending = [];
  const started = performance.now();
  await worker.scheduled({}, env, { waitUntil: p => pending.push(p) });
  await Promise.all(pending);
  return performance.now() - started;
}

const first = await runCron();
const payload = JSON.parse(store.get('payload'));
console.log(`cron build: ${first.toFixed(0)} ms wall`);
console.log('meta:', payload.meta);

const second = await runCron();
console.log(`second build: ${second.toFixed(0)} ms wall (bootstrap facts cached)`);

const res = await worker.fetch(new Request('https://worker.test/data.json'), env);
console.log(
  `GET /data.json -> ${res.status}`,
  `cors=${res.headers.get('access-control-allow-origin')}`,
  `served-from-kv=${(await res.json()).meta.updated_at === JSON.parse(store.get('payload')).meta.updated_at}`,
);

const health = await worker.fetch(new Request('https://worker.test/health'), env);
console.log('GET /health ->', health.status, await health.json());

const preflight = await worker.fetch(new Request('https://worker.test/', { method: 'OPTIONS' }), env);
console.log('OPTIONS ->', preflight.status, preflight.headers.get('access-control-allow-methods'));

if (process.argv.includes('--compare')) {
  const python = JSON.parse(fs.readFileSync('fpl/data.json', 'utf8'));
  const strip = d => {
    const c = structuredClone(d);
    delete c.meta.updated_at;   // always differs
    return JSON.stringify(c);
  };
  const same = strip(python) === strip(payload);
  console.log(same
    ? 'MATCH: worker output is identical to fetch_fpl.py (ignoring updated_at)'
    : 'DIFFERS from fetch_fpl.py: inspect fpl/data.json against the worker payload');
  if (!same) {
    fs.writeFileSync('/tmp/worker-payload.json', JSON.stringify(payload, null, 2));
    console.log('worker payload written to /tmp/worker-payload.json');
    process.exitCode = 1;
  }
}
