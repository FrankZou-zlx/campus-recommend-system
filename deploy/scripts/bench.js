#!/usr/bin/env node
/**
 * 校园二手优选 · 轻量压测脚本（零依赖，只用 Node 内置 http 模块）
 *
 * 用法：
 *   node deploy/scripts/bench.js [总请求数] [并发数]
 *   node deploy/scripts/bench.js 2000 50
 *
 * 默认打三个接口：商品列表、商品详情、分类列表
 * 输出每个接口的请求数、吞吐( req/s )、平均延迟、P95 延迟、错误数
 */
'use strict';

const http = require('http');

const TOTAL = parseInt(process.argv[2] || '2000', 10);
const CONCURRENCY = parseInt(process.argv[3] || '50', 10);
const HOST = process.env.BENCH_HOST || '127.0.0.1';
const PORT = parseInt(process.env.BENCH_PORT || '80', 10);

const TARGETS = [
  { name: 'GET /api/product/list', path: '/api/product/list?page=1&size=12' },
  { name: 'GET /api/category/list', path: '/api/category/list' },
  { name: 'GET /api/notice/list', path: '/api/notice/list' },
  { name: 'GET /api/search/hot', path: '/api/search/hot' }
];

function once(target) {
  return new Promise((resolve) => {
    const started = process.hrtime.bigint();
    const req = http.request(
      { host: HOST, port: PORT, path: target.path, method: 'GET', timeout: 10000 },
      (res) => {
        let bytes = 0;
        res.on('data', (c) => { bytes += c.length; });
        res.on('end', () => {
          const ms = Number(process.hrtime.bigint() - started) / 1e6;
          resolve({ ok: res.statusCode < 400, ms, bytes, status: res.statusCode });
        });
      }
    );
    req.on('error', () => {
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      resolve({ ok: false, ms, bytes: 0, status: 0 });
    });
    req.on('timeout', () => { req.destroy(); });
    req.end();
  });
}

function pct(arr, p) {
  if (!arr.length) return 0;
  const s = arr.slice().sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1);
  return s[Math.max(0, i)];
}

(async () => {
  const perTarget = Math.ceil(TOTAL / TARGETS.length);
  const stats = TARGETS.map((t) => ({ name: t.name, lat: [], err: 0, bytes: 0, done: 0 }));
  const wallStart = process.hrtime.bigint();

  for (let ti = 0; ti < TARGETS.length; ti++) {
    const target = TARGETS[ti];
    const st = stats[ti];
    let issued = 0;

    async function worker() {
      while (issued < perTarget) {
        issued++;
        const r = await once(target);
        st.done++;
        st.lat.push(r.ms);
        st.bytes += r.bytes;
        if (!r.ok) st.err++;
      }
    }

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, perTarget) }, worker));
  }

  const wallSec = Number(process.hrtime.bigint() - wallStart) / 1e9;
  const totalDone = stats.reduce((a, s) => a + s.done, 0);
  const totalErr = stats.reduce((a, s) => a + s.err, 0);
  const allLat = stats.flatMap((s) => s.lat);

  console.log('==============================================');
  console.log('校园二手优选 · 压测实录');
  console.log('==============================================');
  console.log(`目标        ：http://${HOST}:${PORT}`);
  console.log(`并发数      ：${CONCURRENCY}`);
  console.log(`每接口请求  ：${perTarget} × ${TARGETS.length} 接口`);
  console.log(`总请求数    ：${totalDone}`);
  console.log(`总耗时      ：${wallSec.toFixed(2)} s`);
  console.log(`总吞吐      ：${(totalDone / wallSec).toFixed(1)} req/s`);
  console.log(`错误请求    ：${totalErr}（${((totalErr / totalDone) * 100).toFixed(2)}%）`);
  console.log(`平均延迟    ：${(allLat.reduce((a, b) => a + b, 0) / allLat.length).toFixed(1)} ms`);
  console.log(`P95 延迟    ：${pct(allLat, 95).toFixed(1)} ms`);
  console.log(`最大延迟    ：${Math.max(...allLat).toFixed(1)} ms`);
  console.log('----------------------------------------------');
  stats.forEach((s) => {
    const avg = s.lat.reduce((a, b) => a + b, 0) / s.lat.length;
    console.log(
      `${s.name.padEnd(26)} n=${String(s.done).padStart(5)}  ` +
      `avg=${avg.toFixed(1).padStart(7)}ms  p95=${pct(s.lat, 95).toFixed(1).padStart(7)}ms  ` +
      `err=${s.err}  ${(s.bytes / 1024).toFixed(0)}KB`
    );
  });
  console.log('==============================================');
  process.exit(totalErr > 0 ? 1 : 0);
})();
