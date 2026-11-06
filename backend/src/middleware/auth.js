/**
 * 登录鉴权中间件
 * ---------------------------------------------------------------------------
 * 前端把登录接口返回的 JWT 放在请求头：Authorization: Bearer <token>。
 * 校验通过后把载荷挂到 req.user（普通用户）或 req.admin（管理员），
 * 后续路由直接从这两个字段取当前身份，不再信任前端传来的 id。
 */
require('dotenv').config();
const jwt = require('jsonwebtoken');
const { query } = require('../db');

// 签名密钥不设源码内默认值：缺失即启动失败，避免密钥随代码一起公开
if (!process.env.JWT_SECRET) {
  throw new Error('缺少环境变量 JWT_SECRET。本地请配置 backend/.env，服务器请检查 /etc/campus-mall/api.env');
}
const JWT_SECRET = process.env.JWT_SECRET;

/**
 * 从请求头里取出 token 本身（去掉 Bearer 前缀）。
 * 取不到时返回空串，由调用方决定怎么提示。
 */
function readToken(headerText) {
  const parts = headerText.split(' ');
  return parts[1] || '';
}

/**
 * 账号状态缓存
 * ---------------------------------------------------------------------------
 * 验签是纯本地运算，真正需要回库的只有「管理员是否刚禁用这个账号」。
 * 原来每个请求都查一次 user 表，压测时 QPS 越高、数据库越容易被这种
 * 只读查询拖住。缓存 5 秒后，禁用最多延迟 5 秒生效；管理员改状态时会
 * 调用 invalidateAuthCache(id) 主动清掉，实际是即时生效。
 */
const STATUS_TTL_MS = Number(process.env.AUTH_CACHE_TTL_MS || 5000);
const statusCache = new Map(); // userId -> { status, expiresAt }

/** 清掉某个用户（不传则清空全部）的状态缓存，供管理端改状态后调用 */
function invalidateAuthCache(userId) {
  if (userId === undefined || userId === null) statusCache.clear();
  else statusCache.delete(Number(userId));
}

/** 取账号状态：命中缓存就不查库；status=null 表示账号不存在 */
async function readUserStatus(rawId) {
  // 统一成数字做 key：JWT 里的 id 可能是数字也可能是字符串，
  // 若与 invalidateAuthCache(Number(id)) 用的 key 类型不一致，禁用会清不掉缓存。
  const userId = Number(rawId);
  const now = Date.now();
  const hit = statusCache.get(userId);
  if (hit && hit.expiresAt > now) return hit.status;

  const rows = await query('SELECT status FROM `user` WHERE id=?', [userId]);
  const status = rows.length ? Number(rows[0].status) : null;
  statusCache.set(userId, { status, expiresAt: now + STATUS_TTL_MS });

  // 惰性回收：只在表变大时清理过期项，避免长期运行后 Map 无限增长
  if (statusCache.size > 5000) {
    for (const [key, value] of statusCache) {
      if (value.expiresAt <= now) statusCache.delete(key);
    }
  }
  return status;
}

/**
 * 普通用户鉴权
 * ---------------------------------------------------------------------------
 * 两步校验：
 *   1. 验签：令牌是否由本服务签发、是否过期；
 *   2. 查状态：令牌有效不代表账号仍可用 —— 管理员禁用某个用户后，
 *      对方手里的旧令牌还有好几天才过期，所以必须回库确认 status。
 *      这样「禁用」可以立刻生效，不必等到令牌自然过期。
 */
async function auth(req, res, next) {
  const header = req.headers.authorization;
  if (!header) {
    return res.status(401).json({ code: 401, msg: '请先登录' });
  }

  const token = readToken(header);
  if (!token) {
    return res.status(401).json({ code: 401, msg: '登录状态无效' });
  }

  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch (error) {
    return res.status(401).json({ code: 401, msg: '登录已过期，请重新登录' });
  }

  try {
    const status = await readUserStatus(payload.id);
    if (status === null) {
      return res.status(401).json({ code: 401, msg: '账号不存在，请重新登录' });
    }
    if (status === 0) {
      return res.status(403).json({ code: 403, msg: '账号已被管理员禁用，请联系管理员' });
    }
  } catch (error) {
    // 数据库异常不能当成「令牌失效」，否则用户会被莫名踢下线
    return res.status(500).json({ code: 500, msg: '账号状态校验失败，请稍后重试' });
  }

  req.user = payload; // { id, role }
  next();
}

/**
 * 可选鉴权：公开页面用（例如商品详情）
 * ---------------------------------------------------------------------------
 * 没带 token → 当游客放行，req.user = null；
 * 带有效 token → 正常挂 req.user，用于记录浏览行为、判断是否收藏等；
 * token 过期/伪造 → 静默按游客处理，公开页不该因为一个坏 token 报错。
 * 账号被禁用仍返回 403，保持一致。
 */
async function optionalAuth(req, res, next) {
  req.user = null;
  const header = req.headers.authorization;
  if (!header) return next();

  const token = readToken(header);
  if (!token) return next();

  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch (error) {
    return next(); // 过期或伪造：按游客看待
  }

  try {
    const status = await readUserStatus(payload.id);
    if (status === 0) {
      return res.status(403).json({ code: 403, msg: '账号已被管理员禁用，请联系管理员' });
    }
    if (status !== null) req.user = payload;
  } catch (error) {
    return res.status(500).json({ code: 500, msg: '账号状态校验失败，请稍后重试' });
  }
  next();
}

/** 管理员鉴权：先验签，再检查角色是否为 admin */
async function adminAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header) {
    return res.status(401).json({ code: 401, msg: '请先登录后台' });
  }

  const token = readToken(header);
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (payload.role !== 'admin') {
      return res.status(403).json({ code: 403, msg: '无权限' });
    }
    req.admin = payload;
    next();
  } catch (error) {
    return res.status(401).json({ code: 401, msg: '后台登录已过期' });
  }
}

/** 签发 token，默认 7 天有效期 */
function sign(payload, expiresIn = '7d') {
  return jwt.sign(payload, JWT_SECRET, { expiresIn });
}

module.exports = { auth, optionalAuth, adminAuth, sign, invalidateAuthCache };
