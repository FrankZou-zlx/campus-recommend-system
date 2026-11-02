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
    const rows = await query('SELECT status FROM `user` WHERE id=?', [payload.id]);
    if (!rows.length) {
      return res.status(401).json({ code: 401, msg: '账号不存在，请重新登录' });
    }
    if (Number(rows[0].status) === 0) {
      return res.status(403).json({ code: 403, msg: '账号已被管理员禁用，请联系管理员' });
    }
  } catch (error) {
    // 数据库异常不能当成「令牌失效」，否则用户会被莫名踢下线
    return res.status(500).json({ code: 500, msg: '账号状态校验失败，请稍后重试' });
  }

  req.user = payload; // { id, role }
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

module.exports = { auth, adminAuth, sign };
