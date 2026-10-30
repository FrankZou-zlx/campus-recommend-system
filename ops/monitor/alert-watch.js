#!/usr/bin/env node
// =====================================================================
//  简换校园二手交易平台 · 告警守护进程（用户态，无需 root）
//
//  作用：周期抓取后端 /metrics（Prometheus 文本格式），按阈值评估并告警。
//      与 Prometheus alert.rules.yml 中的规则一一对应，在没有 Prometheus
//      的环境里提供同等的告警能力。
//
//  用法：
//      node alert-watch.js                      # 常驻运行（默认 15s 一次）
//      METRICS_URL=http://127.0.0.1:3999/metrics ALERT_FOR_SEC=2 node alert-watch.js
//
//  可调环境变量：
//      METRICS_URL      指标地址（默认 http://127.0.0.1:3001/metrics）
//      INTERVAL_SEC     抓取间隔（默认 15）
//      ALERT_FOR_SEC    持续多久才判定 firing（默认 60）
//      ERR_RATIO        5xx 占比阈值（默认 0.01）
//      P95_SEC          P95 延迟阈值（默认 1）
//      MEM_BYTES        常驻内存阈值（默认 300MB）
//      STATE_FILE       告警状态文件（默认 ./alerts.json）
//      LOG_FILE         告警日志（默认 ./alert.log）
//
//  通知渠道（见 notify.js，未配置的渠道自动禁用）：
//      ALERT_WEBHOOK_URL   钉钉/飞书/企业微信/Server酱/通用 webhook
//      ALERT_SMTP_URL      smtp://用户:授权码@主机:端口 + ALERT_MAIL_TO
//      NOTIFY_PENDING      1 = pending 也通知（默认 0）
//      NOTIFY_RESEND_MS    firing 重复提醒间隔（默认 30 分钟）
// =====================================================================
const http = require('http');
const fs = require('fs');
const path = require('path');
const { notify } = require('./notify');

const METRICS_URL = process.env.METRICS_URL || 'http://127.0.0.1:3001/metrics';
const INTERVAL_MS = (Number(process.env.INTERVAL_SEC) || 15) * 1000;
const FOR_MS = (Number(process.env.ALERT_FOR_SEC) || 60) * 1000;
const ERR_RATIO = Number(process.env.ERR_RATIO || 0.01);
const P95_SEC = Number(process.env.P95_SEC || 1);
const MEM_BYTES = Number(process.env.MEM_BYTES || 300 * 1024 * 1024);
const BASE = __dirname;
const STATE_FILE = process.env.STATE_FILE || path.join(BASE, 'alerts.json');
const LOG_FILE = process.env.LOG_FILE || path.join(BASE, 'alert.log');

// ---------- 拉取指标 ----------
function fetchMetrics(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let buf = '';
      res.on('data', (d) => (buf += d));
      res.on('end', () => resolve(buf));
    });
    req.on('error', reject);
    req.setTimeout(5000, () => { req.destroy(new Error('timeout')); });
  });
}

// ---------- 解析 Prometheus 文本格式 ----------
// 行例：http_requests_total{method="GET",route="/api/x",status="200"} 1234
function parse(text) {
  const out = { reqTotal: 0, req5xx: 0, buckets: new Map(), mem: 0, up: false };
  const lineRe = /^([a-zA-Z_:][a-zA-Z0-9_:]*)(\{([^}]*)\})?\s+([-\d.eE+]+)$/;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(lineRe);
    if (!m) continue;
    const name = m[1];
    const labels = parseLabels(m[3] || '');
    const value = parseFloat(m[4]);
    if (name === 'http_requests_total') {
      out.reqTotal += value;
      if (/^5\d\d$/.test(labels.status || '')) out.req5xx += value;
    } else if (name === 'http_request_duration_seconds_bucket') {
      const le = labels.le === '+Inf' ? Infinity : parseFloat(labels.le);
      out.buckets.set(le, (out.buckets.get(le) || 0) + value);
    } else if (name === 'node_process_resident_memory_bytes') {
      out.mem = value;
    }
    out.up = true;
  }
  return out;
}

function parseLabels(s) {
  const o = {};
  const re = /([a-zA-Z_][a-zA-Z0-9_]*)="((?:[^"\\]|\\.)*)"/g;
  let m;
  while ((m = re.exec(s))) o[m[1]] = m[2];
  return o;
}

// ---------- 直方图分位数（与 Prometheus histogram_quantile 同算法）----------
function histogramQuantile(bucketMap, q) {
  const buckets = [...bucketMap.entries()]
    .map(([le, count]) => ({ le, count }))
    .sort((a, b) => (a.le === Infinity ? 1 : b.le === Infinity ? -1 : a.le - b.le));
  if (!buckets.length) return 0;
  const total = buckets.reduce((max, b) => (b.le === Infinity ? Math.max(max, b.count) : max), 0);
  const sum = buckets[buckets.length - 1].count || total;
  if (!sum) return 0;
  const rank = q * sum;
  for (let i = 0; i < buckets.length; i++) {
    if (buckets[i].count >= rank) {
      if (i === 0) return buckets[0].le === Infinity ? 0 : buckets[0].le;
      const lo = buckets[i - 1];
      const hi = buckets[i];
      const denom = hi.count - lo.count;
      const frac = denom > 0 ? (rank - lo.count) / denom : 0;
      const loLe = lo.le === Infinity ? 0 : lo.le;
      const hiLe = hi.le === Infinity ? hi.le : hi.le;
      return loLe + (hiLe - loLe) * frac;
    }
  }
  const last = buckets[buckets.length - 1];
  return last.le === Infinity ? Infinity : last.le;
}

// ---------- 告警状态机 ----------
// 每条告警：连续满足阈值超过 for 时长才置为 firing，恢复即 resolving
const state = { APIDown: null, HighErrorRate: null, HighP95Latency: null, HighMemoryUsage: null };

// 处置建议（与 monitoring/alert.rules.yml 的 runbook 保持一致）
const RUNBOOK = {
  APIDown: 'systemctl status campus-mall-api；journalctl -u campus-mall-api -n 50',
  HighErrorRate: 'topk(5, sum by (route,status) (rate(http_requests_total{status=~"5.."}[5m]))) 定位错误路由',
  HighP95Latency: '排查慢路由 topk(5, sum by (route) (rate(http_request_duration_seconds_sum[5m])) / sum by (route) (rate(http_request_duration_seconds_count[5m])))',
  HighMemoryUsage: '观察 node_heap_size_used_bytes 趋势，必要时重启并排查堆增长',
};

// 通知发送结果落日志：渠道失败不阻塞告警评估，但必须可排查
function pushNotify(level, name, detail, severity, runbook) {
  notify(level, name, detail, severity, runbook)
    .then((r) => { if (r && !r.skipped) log('NOTIFY', name, JSON.stringify(r), severity); })
    .catch(() => { /* notify 内部已兜错，双保险 */ });
}

function evaluate(name, breached, detail, severity) {
  const now = Date.now();
  const s = state[name];
  const runbook = RUNBOOK[name];
  if (breached) {
    if (!s) {
      state[name] = { since: now, firing: false, detail, severity };
      log('PENDING', name, detail, severity);
      // pending 默认静默（降噪），由 notify 内部按 NOTIFY_PENDING 决定
      pushNotify('pending', name, detail, severity, runbook);
    } else {
      s.detail = detail;
      if (!s.firing && now - s.since >= FOR_MS) {
        s.firing = true;
        log('FIRING', name, detail, severity);
        pushNotify('firing', name, detail, severity, runbook); // 异步，不阻塞评估循环
      }
    }
  } else if (s) {
    if (s.firing) {
      log('RESOLVED', name, s.detail, severity);
      pushNotify('resolved', name, s.detail, severity, runbook);
    }
    state[name] = null;
  }
}

function log(level, name, detail, severity) {
  const line = `[${new Date().toISOString()}] ${level.padEnd(8)} ${severity || '-'} ${name}  ${detail}`;
  console.log(line);
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch (e) { /* 日志写失败不影响告警 */ }
}

function writeState(extra) {
  const payload = {
    ts: new Date().toISOString(),
    source: METRICS_URL,
    alerts: Object.entries(state)
      .filter(([, v]) => v)
      .map(([name, v]) => ({ name, state: v.firing ? 'firing' : 'pending', since: new Date(v.since).toISOString(), severity: v.severity, detail: v.detail })),
    ...extra,
  };
  try { fs.writeFileSync(STATE_FILE, JSON.stringify(payload, null, 2)); } catch (e) { /* ignore */ }
}

// ---------- 主循环 ----------
// 5xx 占比用「计数器增量」算：Prometheus 的 http_requests_total 是累加值，
// 直接除当前值等于统计开服以来的总量，必须用窗口内的增量才有意义。
let prev = null;

async function tick() {
  let text;
  try {
    text = await fetchMetrics(METRICS_URL);
  } catch (e) {
    prev = null;
    evaluate('APIDown', true, `抓取 ${METRICS_URL} 失败：${e.message}`, 'critical');
    writeState({ error: e.message });
    return;
  }
  evaluate('APIDown', false, '服务可达');

  const cur = parse(text);
  let ratio = 0;
  if (prev && cur.reqTotal > prev.reqTotal) {
    const dTotal = cur.reqTotal - prev.reqTotal;
    const d5xx = Math.max(0, cur.req5xx - prev.req5xx);
    ratio = dTotal > 0 ? d5xx / dTotal : 0;
  }
  prev = cur;

  evaluate('HighErrorRate', ratio > ERR_RATIO,
    `窗口内 5xx 占比 ${(ratio * 100).toFixed(2)}% > 阈值 ${(ERR_RATIO * 100).toFixed(2)}%`, 'critical');

  const p95 = histogramQuantile(cur.buckets, 0.95);
  evaluate('HighP95Latency', p95 > P95_SEC,
    `P95 ${p95.toFixed(3)}s > 阈值 ${P95_SEC}s`, 'warning');

  evaluate('HighMemoryUsage', cur.mem > MEM_BYTES,
    `RSS ${(cur.mem / 1024 / 1024).toFixed(1)}MB > 阈值 ${(MEM_BYTES / 1024 / 1024).toFixed(0)}MB`, 'warning');

  writeState({ p95: Number(p95.toFixed(3)), errRatio: Number(ratio.toFixed(4)), rssMB: Number((cur.mem / 1024 / 1024).toFixed(1)) });
}

console.log(`告警守护进程启动：源 ${METRICS_URL} · 间隔 ${INTERVAL_MS / 1000}s · 持续阈值 ${FOR_MS / 1000}s`);
console.log(`  5xx 占比 > ${(ERR_RATIO * 100).toFixed(2)}%   P95 > ${P95_SEC}s   RSS > ${MEM_BYTES / 1024 / 1024}MB`);
{
  const chans = [];
  if (process.env.ALERT_WEBHOOK_URL) chans.push(`webhook(${require('./notify').detectPlatform(process.env.ALERT_WEBHOOK_URL)})`);
  if (process.env.ALERT_SMTP_URL && process.env.ALERT_MAIL_TO) chans.push('mail(smtp)');
  console.log(`  通知渠道：${chans.length ? chans.join(' + ') : '未配置（告警仅落 alerts.json 与日志）'}`);
}
tick();
setInterval(tick, INTERVAL_MS);
