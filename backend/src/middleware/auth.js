require('dotenv').config();
const jwt = require('jsonwebtoken');

// 签名密钥不设源码内默认值：缺失即启动失败，避免密钥随代码一起公开
if (!process.env.JWT_SECRET) {
  throw new Error('缺少环境变量 JWT_SECRET。本地请配置 backend/.env，服务器请检查 /etc/campus-mall/api.env');
}
const SECRET = process.env.JWT_SECRET;

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
