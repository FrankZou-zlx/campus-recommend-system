#!/usr/bin/env node
// =====================================================================
//  简换校园二手交易平台 · 告警通知模块（零依赖，仅用 Node 内置模块）
//
//  作用：把 alert-watch.js 评估出的告警推到通知渠道，形成
//        「指标采集 → 阈值评估 → 状态机 → 通知」完整闭环。
//
//  支持的渠道（均免费；未配置的渠道自动禁用，不报错）：
//    1. Webhook 机器人 —— 自动识别平台并适配 payload 格式：
//       钉钉 / 飞书 / 企业微信 / Server酱 / 通用 JSON webhook
//    2. 邮件 —— 裸 SMTP 协议实现（不装 nodemailer），
//       支持 465 隐式 SSL 与 587 STARTTLS
//
//  用法（被 alert-watch.js require）：
//      const { notify } = require('./notify');
//      await notify('firing', 'HighErrorRate', '详情', 'critical', 'runbook');
//
//  环境变量：
//      ALERT_WEBHOOK_URL        webhook 地址（不配则不发 webhook）
//      ALERT_WEBHOOK_TIMEOUT_MS 超时毫秒（默认 5000）
//      ALERT_SMTP_URL           smtp://用户:授权码@主机:端口（不配则不发邮件）
//      ALERT_MAIL_TO            收件人，多个用逗号分隔
//      NOTIFY_PENDING           1 = pending 状态也通知（默认 0，降噪）
//      NOTIFY_RESEND_MS         同一告警 firing 的重复提醒间隔
//                               （默认 1800000 = 30 分钟）
// =====================================================================
'use strict';
const http = require('http');
const https = require('https');
const net = require('net');
const tls = require('tls');
const { URL } = require('url');

const WEBHOOK_URL = (process.env.ALERT_WEBHOOK_URL || '').trim();
const WEBHOOK_TIMEOUT_MS = Number(process.env.ALERT_WEBHOOK_TIMEOUT_MS || 5000);
const SMTP_URL = (process.env.ALERT_SMTP_URL || '').trim();
const MAIL_TO = (process.env.ALERT_MAIL_TO || '').trim();
const NOTIFY_PENDING = process.env.NOTIFY_PENDING === '1';
const RESEND_MS = Number(process.env.NOTIFY_RESEND_MS || 30 * 60 * 1000);

// 同一告警的发送记录：{ [name]: lastFiringNotifyTs }
const lastFiringNotify = {};
let seq = 0; // 单调递增，防止同一毫秒内多个告警共用 Map 键

// ---------------------------------------------------------------- 消息文本
function formatMessage(level, name, detail, severity, runbook) {
  const tag = { firing: '🔴 告警触发', resolved: '🟢 告警恢复', pending: '🟡 疑似异常' }[level] || level;
  const lines = [
    `【${tag} · ${severity || '-'}】简换校园二手交易平台`,
    `告警项：${name}`,
    `详情：${detail}`,
    `时间：${new Date().toISOString()}`,
  ];
  if (runbook) lines.push(`处置建议：${runbook}`);
  return lines.join('\n');
}

// ---------------------------------------------------------------- webhook
function detectPlatform(url) {
  if (/oapi\.dingtalk\.com/.test(url)) return 'dingtalk';
  if (/open\.feishu\.cn/.test(url)) return 'feishu';
  if (/qyapi\.weixin\.qq\.com/.test(url)) return 'wecom';
  if (/sctapi\.ft07\.com|sctapi|serverchan/i.test(url)) return 'serverchan';
  return 'generic';
}

// 按平台构造 payload（差异只在最外层包装，正文统一用 formatMessage）
function buildWebhookPayload(platform, title, text, meta) {
  switch (platform) {
    case 'dingtalk':
      return { msgtype: 'markdown', markdown: { title, text: `### ${title}\n\n${text.replace(/\n/g, '\n\n')}` } };
    case 'feishu':
      return { msg_type: 'text', content: { text: `${title}\n${text}` } };
    case 'wecom':
      return { msgtype: 'markdown', markdown: { content: `${title}\n\n${text.replace(/\n/g, '\n\n')}` } };
    case 'serverchan':
      return { title, desp: text };
    default:
      return { ...meta, title, text }; // 通用：保留结构化字段，便于自建消费端解析
  }
}

function postJson(url, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === 'https:' ? https : http;
    const data = JSON.stringify(body);
    const req = mod.request({
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
      timeout: timeoutMs,
    }, (res) => {
      let buf = '';
      res.on('data', (d) => (buf += d));
      res.on('end', () => resolve({ status: res.statusCode, body: buf.slice(0, 300) }));
    });
    req.on('timeout', () => req.destroy(new Error('webhook timeout')));
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function sendWebhook(level, name, detail, severity, runbook) {
  const platform = detectPlatform(WEBHOOK_URL);
  const title = `【${level === 'firing' ? '告警' : level === 'resolved' ? '恢复' : '异常'}】${name}`;
  const text = formatMessage(level, name, detail, severity, runbook);
  const body = buildWebhookPayload(platform, title, text, { level, alert: name, detail, severity, runbook, ts: new Date().toISOString() });
  const r = await postJson(WEBHOOK_URL, body, WEBHOOK_TIMEOUT_MS);
  if (r.status >= 400) throw new Error(`webhook HTTP ${r.status}: ${r.body}`);
  return platform;
}

// ---------------------------------------------------------------- 邮件（裸 SMTP）
function parseSmtpUrl(raw) {
  const u = new URL(raw);
  return {
    host: u.hostname,
    port: Number(u.port || (u.protocol === 'smtps:' ? 465 : 587)),
    user: decodeURIComponent(u.username),
    pass: decodeURIComponent(u.password),
    secure: u.protocol === 'smtps:' || Number(u.port) === 465,
  };
}

// 读一条完整 SMTP 响应（可能多行，格式 "250-xxx" / "250 xxx"）
function readReply(sock) {
  return new Promise((resolve, reject) => {
    let buf = '';
    const onData = (d) => {
      buf += d.toString('utf8');
      const lines = buf.split(/\r?\n/).filter(Boolean);
      const last = lines[lines.length - 1] || '';
      if (/^\d{3} /.test(last)) { // 末行 "250 " 表示响应结束（"-" 表示还有后续行）
        sock.removeListener('data', onData);
        sock.removeListener('error', onErr);
        const code = parseInt(last.slice(0, 3), 10);
        code >= 400 ? reject(new Error(`SMTP ${last.trim()}`)) : resolve(lines.join(' | '));
      }
    };
    const onErr = reject;
    sock.on('data', onData);
    sock.on('error', onErr);
  });
}

function sendCmd(sock, cmd) {
  return new Promise((resolve, reject) => {
    readReply(sock).then(resolve, reject);
    sock.write(cmd + '\r\n');
  });
}

function encodeHeader(s) {
  return '=?UTF-8?B?' + Buffer.from(String(s), 'utf8').toString('base64') + '?=';
}

async function smtpSend(cfg, subject, text) {
  const to = MAIL_TO.split(',').map((s) => s.trim()).filter(Boolean);
  if (!to.length) throw new Error('ALERT_MAIL_TO 未配置');
  const from = cfg.user;

  let sock;
  if (cfg.secure) {
    sock = await new Promise((resolve, reject) => {
      const s = tls.connect({ host: cfg.host, port: cfg.port, servername: cfg.host }, () => resolve(s));
      s.on('error', reject);
    });
    await readReply(sock);
    await sendCmd(sock, 'EHLO campus-mall'); // 隐式 SSL 也必须 EHLO，否则后续命令被 503 拒绝
  } else {
    sock = await new Promise((resolve, reject) => {
      const s = net.connect({ host: cfg.host, port: cfg.port }, () => resolve(s));
      s.on('error', reject);
    });
    await readReply(sock);
    await sendCmd(sock, `EHLO campus-mall`);
    if (sock instanceof tls.TLSSocket === false) {
      // 尝试 STARTTLS 升级；不支持则继续明文（内网/测试服务器可接受）
      try {
        await sendCmd(sock, 'STARTTLS');
        sock = await new Promise((resolve, reject) => {
          const s = tls.connect({ socket: sock, servername: cfg.host }, () => resolve(s));
          s.on('error', reject);
        });
        await sendCmd(s, `EHLO campus-mall`);
      } catch (e) { /* 服务器不支持 STARTTLS 时保持明文 */ }
    }
  }

  if (cfg.user) {
    await sendCmd(sock, 'AUTH LOGIN');
    await sendCmd(sock, Buffer.from(cfg.user).toString('base64'));
    await sendCmd(sock, Buffer.from(cfg.pass).toString('base64'));
  }
  await sendCmd(sock, `MAIL FROM:<${from}>`);
  for (const rcpt of to) await sendCmd(sock, `RCPT TO:<${rcpt}>`);
  await sendCmd(sock, 'DATA');
  const mime = [
    `From: ${from}`,
    `To: ${to.join(', ')}`,
    `Subject: ${encodeHeader(subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    '',
    text,
  ].join('\r\n');
  await sendCmd(sock, mime + '\r\n.');
  await sendCmd(sock, 'QUIT');
  sock.end();
  return to.length;
}

// ---------------------------------------------------------------- 统一入口
async function notify(level, name, detail, severity, runbook) {
  if (level === 'pending' && !NOTIFY_PENDING) return { skipped: 'pending 静默（降噪）' };

  const out = { webhook: null, mail: null };

  // firing 冷却：同一告警 RESEND_MS 内只提醒一次，防止每周期轰炸
  if (level === 'firing') {
    const key = name;
    const last = lastFiringNotify[key] || 0;
    if (Date.now() - last < RESEND_MS) return { skipped: `冷却中（${Math.ceil((RESEND_MS - (Date.now() - last)) / 1000)}s 后重发）` };
    lastFiringNotify[key] = Date.now();
  }
  if (level === 'resolved') delete lastFiringNotify[name];

  if (WEBHOOK_URL) {
    try {
      out.webhook = await sendWebhook(level, name, detail, severity, runbook);
    } catch (e) {
      out.webhook = `FAIL: ${e.message}`; // 通知失败绝不拖垮告警主流程
    }
  }
  if (SMTP_URL && MAIL_TO) {
    try {
      const cfg = parseSmtpUrl(SMTP_URL);
      const subject = `【${level === 'firing' ? '告警' : '恢复'}】${name} (${severity || '-'})`;
      out.mail = await smtpSend(cfg, subject, formatMessage(level, name, detail, severity, runbook));
    } catch (e) {
      out.mail = `FAIL: ${e.message}`;
    }
  }
  return out;
}

module.exports = { notify, formatMessage, detectPlatform, buildWebhookPayload, parseSmtpUrl };
