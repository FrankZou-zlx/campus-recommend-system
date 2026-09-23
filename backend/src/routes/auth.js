const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { query } = require('../db');
const { sign } = require('../middleware/auth');

// 手机号必须为 11 位数字（前端已实时提示，这里做最后一道兜底）
function phoneError(phone) {
  const s = String(phone == null ? '' : phone).trim();
  if (!s) return '';                                   // 选填，留空放行
  if (!/^\d+$/.test(s)) return '手机号只能是数字';
  if (s.length < 11) return `手机号需 11 位，还差 ${11 - s.length} 位`;
  if (s.length > 11) return `手机号超出 11 位（当前 ${s.length} 位），请检查`;
  return '';
}

// 账号去空格：前后空格、中间空格都不算有效字符（前端已实时处理，这里兜底）
function cleanUsername(v) {
  return String(v == null ? '' : v).replace(/\s+/g, '');
}

// 用户注册
router.post('/register', async (req, res) => {
  try {
    const { password, nickname, email, phone } = req.body;
    const username = cleanUsername(req.body.username);
    if (!username || !password) return res.status(400).json({ code: 400, msg: username ? '账号和密码必填' : '请输入账号（不能只输入空格）' });
    const pe = phoneError(phone);
    if (pe) return res.status(400).json({ code: 400, msg: pe });
    const exist = await query('SELECT id FROM user WHERE username=?', [username]);
    if (exist.length) return res.status(400).json({ code: 400, msg: '该账号已存在' });
    const hash = bcrypt.hashSync(password, 10);
    await query(
      'INSERT INTO user(username,password,nickname,email,phone,role) VALUES(?,?,?,?,?,0)',
      [username, hash, nickname || username, email || '', phone || '']
    );
    res.json({ code: 0, msg: '注册成功' });
  } catch (e) {
    res.status(500).json({ code: 500, msg: '注册失败: ' + e.message });
  }
});

// 用户登录
router.post('/login', async (req, res) => {
  try {
    const username = cleanUsername(req.body.username);
    const { password } = req.body;
    if (!username) return res.status(400).json({ code: 400, msg: '请输入账号（不能只输入空格）' });
    if (!password) return res.status(400).json({ code: 400, msg: '请输入密码' });
    const users = await query('SELECT * FROM user WHERE username=?', [username]);
    // 安全 + 体验兼顾：不区分“账号不存在”和“密码错误”，统一提示，避免被撞库探测
    if (!users.length) return res.status(400).json({ code: 400, msg: '账号或密码不正确' });
    const u = users[0];
    if (!bcrypt.compareSync(password || '', u.password))
      return res.status(400).json({ code: 400, msg: '账号或密码不正确' });
    const token = sign({ id: u.id, role: u.role });
    res.json({
      code: 0, msg: '登录成功',
      data: { token, user: { id: u.id, username: u.username, nickname: u.nickname, role: u.role, avatar: u.avatar } }
    });
  } catch (e) {
    res.status(500).json({ code: 500, msg: '登录失败: ' + e.message });
  }
});

// 管理员登录（账号 admin / admin123）
router.post('/admin/login', async (req, res) => {
  try {
    const username = cleanUsername(req.body.username);
    const { password } = req.body;
    if (!username) return res.status(400).json({ code: 400, msg: '请输入管理员账号（不能只输入空格）' });
    if (!password) return res.status(400).json({ code: 400, msg: '请输入管理员密码' });
    const rows = await query('SELECT * FROM admin WHERE username=?', [username]);
    if (!rows.length) return res.status(400).json({ code: 400, msg: '管理员账号或密码不正确' });
    const a = rows[0];
    if (!bcrypt.compareSync(password || '', a.password))
      return res.status(400).json({ code: 400, msg: '管理员账号或密码不正确' });
    const token = sign({ id: a.id, role: 'admin' });
    res.json({ code: 0, msg: '后台登录成功', data: { token } });
  } catch (e) {
    res.status(500).json({ code: 500, msg: '登录失败' });
  }
});

module.exports = router;
