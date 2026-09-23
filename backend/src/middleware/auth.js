const jwt = require('jsonwebtoken');
const SECRET = process.env.JWT_SECRET || 'campus-mall-dev-secret-2026';

// 用户鉴权中间件：校验 Authorization: Bearer <token>
function auth(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ code: 401, msg: '请先登录' });
  const token = header.split(' ')[1];
  if (!token) return res.status(401).json({ code: 401, msg: '登录状态无效' });
  try {
    const payload = jwt.verify(token, SECRET);
    req.user = payload; // { id, role }
    next();
  } catch (e) {
    return res.status(401).json({ code: 401, msg: '登录已过期，请重新登录' });
  }
}

// 管理员鉴权中间件
async function adminAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ code: 401, msg: '请先登录后台' });
  const token = header.split(' ')[1];
  try {
    const payload = jwt.verify(token, SECRET);
    if (payload.role !== 'admin') return res.status(403).json({ code: 403, msg: '无权限' });
    req.admin = payload;
    next();
  } catch (e) {
    return res.status(401).json({ code: 401, msg: '后台登录已过期' });
  }
}

function sign(payload, expiresIn = '7d') {
  return jwt.sign(payload, SECRET, { expiresIn });
}

module.exports = { auth, adminAuth, sign };
