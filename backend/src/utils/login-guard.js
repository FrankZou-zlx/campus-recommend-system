/**
 * 登录失败限流（进程内内存版）
 * ---------------------------------------------------------------------------
 * 单实例部署够用；将来如果横向扩到多个 Node 进程，这里要换成 Redis 之类的
 * 共享存储，否则每个实例各算各的。
 *
 * 两个维度：
 *   - 同一账号：10 分钟内连续错 5 次即锁定，挡住针对单个账号的撞库；
 *   - 同一来源 IP：10 分钟内错 20 次即锁定，挡住拿一批账号挨个试的撞库。
 *
 * 注意生产部署里后端在 Nginx 后面，remoteAddress 恒为 127.0.0.1。
 * 只有当 X-Forwarded-For 给出了一个真实客户端地址时才启用 IP 维度，
 * 否则会把所有用户算到同一个 key 上，一次攻击就能把整站登录锁死。
 */
const WINDOW_MS = 10 * 60 * 1000;
const ACCOUNT_LIMIT = 5;
const IP_LIMIT = 20;

const failures = new Map(); // key -> { count, until }

function forwardedIp(req) {
  const raw = req.headers['x-forwarded-for'];
  const first = (Array.isArray(raw) ? raw[0] : String(raw || '')).split(',')[0].trim();
  return first || (req.socket.remoteAddress || '').replace(/^::ffff:/, '') || 'unknown';
}

function isLoopback(ip) {
  return !ip || ip === 'unknown' || ip === '127.0.0.1' || ip === '::1' || ip.startsWith('::ffff:127.');
}

function keys(req, username) {
  const list = ['u:' + String(username || '').toLowerCase()];
  const ip = forwardedIp(req);
  if (!isLoopback(ip)) list.push('ip:' + ip);
  return list;
}

/** 返回 { allowed, retryAfter }；retryAfter 单位为秒 */
function check(req, username) {
  const now = Date.now();
  let blockedUntil = 0;
  for (const key of keys(req, username)) {
    const hit = failures.get(key);
    if (!hit) continue;
    if (hit.until <= now) {
      failures.delete(key); // 窗口已过，惰性清理
      continue;
    }
    const limit = key.startsWith('ip:') ? IP_LIMIT : ACCOUNT_LIMIT;
    if (hit.count >= limit) blockedUntil = Math.max(blockedUntil, hit.until);
  }
  return blockedUntil
    ? { allowed: false, retryAfter: Math.ceil((blockedUntil - now) / 1000) }
    : { allowed: true, retryAfter: 0 };
}

/** 一次密码/账号校验失败 */
function recordFailure(req, username) {
  const now = Date.now();
  for (const key of keys(req, username)) {
    const hit = failures.get(key);
    if (!hit || hit.until <= now) failures.set(key, { count: 1, until: now + WINDOW_MS });
    else hit.count += 1;
  }
  // 防止 Map 长期增长（登录量不大，惰性回收足够）
  if (failures.size > 10000) {
    for (const [key, value] of failures) {
      if (value.until <= now) failures.delete(key);
    }
  }
}

/** 登录成功：清掉该账号与来源的失败记录 */
function recordSuccess(req, username) {
  for (const key of keys(req, username)) failures.delete(key);
}

module.exports = { check, recordFailure, recordSuccess };
