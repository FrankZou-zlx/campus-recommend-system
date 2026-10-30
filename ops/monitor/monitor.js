#!/usr/bin/env node
// 轻量监控面板（零依赖，仅用 Node 内置模块）
// 周期性抓取后端 /metrics（Prometheus 文本格式），解析后在网页展示实时指标
// 访问: SSH 隧道后浏览器开 http://127.0.0.1:9099  （页面每 5s 自动刷新）
const http = require('http');

const METRICS_URL = 'http://127.0.0.1:3001/metrics';
const PORT = 9099;
const INTERVAL = 5000;

let lastRaw = '';
let prevTotal = {};      // 各路由上一轮累计请求数，用于算 QPS
let state = { ts: '', routes: {}, qpsTotal: 0, errRate: '0.000', memG: '0' };

function get(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      let buf = '';
      res.on('data', (c) => (buf += c));
      res.on('end', () => resolve(buf));
    });
    req.on('error', () => resolve(''));
    req.setTimeout(3000, () => { req.destroy(); resolve(''); });
  });
}

// 解析 Prometheus 文本格式 -> { counters:{route:{total,err}}, lat:{route:{buckets,sum,count}}, mem }
function parse(text) {
  const out = { counters: {}, lat: {}, mem: 0 };
  (text || '').split('\n').forEach((line) => {
    if (!line || line[0] === '#') return;
    const m = line.match(/^([\w]+)(?:\{([^}]*)\})?\s+(-?[\d.eE+]+)$/);
    if (!m) return;
    const name = m[1];
    const labelStr = m[2] || '';
    const val = parseFloat(m[3]);
    const labels = {};
    if (labelStr) labelStr.split(',').forEach((p) => {
      const eq = p.indexOf('=');
      labels[p.slice(0, eq)] = p.slice(eq + 1).replace(/^"|"$/g, '');
    });
    const route = labels.route || '(other)';
    if (name === 'http_requests_total') {
      out.counters[route] = out.counters[route] || { total: 0, err: 0 };
      out.counters[route].total += val;
      if (Number(labels.status) >= 500) out.counters[route].err += val;
    } else if (name === 'http_request_duration_seconds_bucket') {
      (out.lat[route] = out.lat[route] || { buckets: [] }).buckets.push({ le: parseFloat(labels.le), count: val });
    } else if (name === 'http_request_duration_seconds_sum') {
      (out.lat[route] = out.lat[route] || { buckets: [] }).sum = val;
    } else if (name === 'http_request_duration_seconds_count') {
      (out.lat[route] = out.lat[route] || { buckets: [] }).count = val;
    } else if (name === 'node_process_resident_memory_bytes') {
      out.mem = val;
    }
  });
  return out;
}

// 由直方图桶线性插值算 Pxx 分位（返回毫秒）
function quantile(buckets, p) {
  if (!buckets || buckets.length === 0) return 0;
  const total = buckets[buckets.length - 1].count;   // +Inf 桶 = 总样本数
  if (total === 0) return 0;
  const target = p * total;
  const bs = [...buckets].sort((a, b) => a.le - b.le);
  let cum = 0;
  for (let i = 0; i < bs.length; i++) {
    const prevCum = cum;
    cum = bs[i].count;
    if (cum >= target) {
      const lower = i > 0 ? bs[i - 1].le : 0;
      const upper = bs[i].le;
      if (upper === Infinity) return lower * 1000;
      const frac = (target - prevCum) / ((cum - prevCum) || 1);
      return (lower + frac * (upper - lower)) * 1000;
    }
  }
  return bs[bs.length - 1].le * 1000;
}

function compute() {
  const p = parse(lastRaw);
  const now = Date.now();
  const dt = (now - (compute._last || now)) / 1000 || INTERVAL / 1000;
  compute._last = now;

  const routes = {};
  let qpsTotal = 0, errTotal = 0, reqTotal = 0;
  for (const [route, c] of Object.entries(p.counters)) {
    const prev = prevTotal[route] || 0;
    const qps = Math.max(0, (c.total - prev) / dt);
    prevTotal[route] = c.total;
    const errRate = c.total ? (c.err / c.total) * 100 : 0;
    const p95 = quantile(p.lat[route] && p.lat[route].buckets, 0.95);
    routes[route] = { qps, p95, errRate, total: c.total };
    qpsTotal += qps; errTotal += c.err; reqTotal += c.total;
  }
  const errRateTotal = reqTotal ? ((errTotal / reqTotal) * 100).toFixed(3) : '0.000';
  const memG = p.mem ? (p.mem / 1024 / 1024 / 1024).toFixed(2) : '0';
  state = {
    ts: new Date().toLocaleString('zh-CN'),
    routes,
    qpsTotal,
    errRate: errRateTotal,
    memG,
    routeCount: Object.keys(routes).length,
  };
}

function rowHtml(rk, r) {
  return `<tr><td>${rk}</td><td>${r.qps.toFixed(1)}</td><td>${r.p95.toFixed(1)}</td>` +
    `<td class="${r.errRate > 0 ? 'tag' : ''}">${r.errRate.toFixed(2)}%</td><td>${r.total}</td></tr>`;
}

function page() {
  const rows = Object.keys(state.routes).sort().map((rk) => rowHtml(rk, state.routes[rk])).join('');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta http-equiv="refresh" content="5">
<title>校园二手平台 · 实时监控</title>
<style>
 body{font-family:-apple-system,Segoe UI,Roboto,'Microsoft YaHei',sans-serif;background:#0f172a;color:#e2e8f0;margin:0;padding:24px}
 h1{font-size:20px;margin:0 0 4px} .sub{color:#94a3b8;font-size:13px;margin-bottom:18px}
 .cards{display:flex;gap:14px;flex-wrap:wrap;margin-bottom:20px}
 .card{background:#1e293b;border:1px solid #334155;border-radius:10px;padding:16px 20px;min-width:140px}
 .card .k{color:#94a3b8;font-size:12px}.card .v{font-size:26px;font-weight:700;color:#38bdf8;margin-top:4px}
 table{width:100%;border-collapse:collapse;background:#1e293b;border-radius:10px;overflow:hidden}
 th,td{padding:10px 14px;text-align:left;border-bottom:1px solid #334155;font-size:14px}
 th{background:#334155;color:#cbd5e1}.tag{color:#f87171;font-weight:700}
</style></head><body>
<h1>校园二手优选 · 实时监控面板</h1>
<div class="sub">数据源：后端 /metrics（Prometheus 格式）· 刷新于 ${state.ts} · 每 ${INTERVAL / 1000}s 采样</div>
<div class="cards">
 <div class="card"><div class="k">总 QPS</div><div class="v">${state.qpsTotal.toFixed(1)}</div></div>
 <div class="card"><div class="k">错误率</div><div class="v">${state.errRate}%</div></div>
 <div class="card"><div class="k">Node 内存</div><div class="v">${state.memG} GB</div></div>
 <div class="card"><div class="k">采样路由数</div><div class="v">${state.routeCount}</div></div>
</div>
<table><thead><tr><th>接口路由</th><th>QPS</th><th>P95 延迟(ms)</th><th>错误率</th><th>累计请求</th></tr></thead>
<tbody>${rows || '<tr><td colspan=5>等待采样…</td></tr>'}</tbody></table>
</body></html>`;
}

async function tick() {
  const raw = await get(METRICS_URL);
  if (raw) { lastRaw = raw; compute(); }
}

const server = http.createServer((req, res) => {
  if (req.url === '/api/state') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(state));
  } else {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(page());
  }
});

tick();
setInterval(tick, INTERVAL);
server.listen(PORT, '127.0.0.1', () => {
  console.log(`监控面板已启动: http://127.0.0.1:${PORT}  (抓取 ${METRICS_URL})`);
});
