const express = require('express');
const router = express.Router();
const { query } = require('../db');
const { auth } = require('../middleware/auth');
const bcrypt = require('bcryptjs');
const { sensitiveError } = require('../utils/sensitive');

// 手机号校验：必须 11 位数字（与前端提示文案保持一致）
// required=true 时不允许为空；返回 '' 表示通过，否则返回给用户看的原因
function phoneError(phone, required) {
  const s = String(phone == null ? '' : phone).trim();
  if (!s) return required ? '请填写手机号（11 位）' : '';
  if (!/^\d+$/.test(s)) return '手机号只能是数字';
  if (s.length < 11) return `手机号需 11 位，还差 ${11 - s.length} 位`;
  if (s.length > 11) return `手机号超出 11 位（当前 ${s.length} 位），请检查`;
  return '';
}

// 获取当前用户资料
// seller_mode 一并返回：个人中心要靠它渲染「AI 自动回复」开关的当前状态
router.get('/profile', auth, async (req, res) => {
  const rows = await query(
    'SELECT id,username,nickname,avatar,email,phone,role,seller_mode,created_at FROM user WHERE id=?',
    [req.user.id]
  );
  if (!rows.length) return res.status(404).json({ code: 404, msg: '用户不存在' });
  res.json({ code: 0, data: rows[0] });
});

// 开关 AI 自动回复（本人操作，改自己的 seller_mode）
// auto   = AI 代答：买家发来私信时由 ai-seller 服务自动回复
// manual = 自己回：买家发来私信后不会触发自动回复
router.put('/seller-mode', auth, async (req, res) => {
  const mode = String((req.body && req.body.mode) || '').trim();
  if (mode !== 'auto' && mode !== 'manual') {
    return res.status(400).json({ code: 400, msg: '参数不合法，只能是 auto 或 manual' });
  }
  // 只允许在 auto / manual 两个值之间切换，不接受其他任何字符串
  await query('UPDATE user SET seller_mode=? WHERE id=?', [mode, req.user.id]);
  res.json({
    code: 0,
    msg: mode === 'auto' ? '已开启 AI 自动回复' : '已关闭 AI 自动回复',
    data: { seller_mode: mode }
  });
});

// 更新资料
router.put('/profile', auth, async (req, res) => {
  const { nickname, email, phone, avatar } = req.body;
  const pe = phoneError(phone, false);
  if (pe) return res.status(400).json({ code: 400, msg: pe });
  const se = sensitiveError(nickname, '昵称');
  if (se) return res.status(400).json({ code: 400, msg: se });
  await query(
    'UPDATE user SET nickname=?,email=?,phone=?,avatar=? WHERE id=?',
    [nickname || '', email || '', String(phone || '').trim(), avatar || '', req.user.id]
  );
  res.json({ code: 0, msg: '更新成功' });
});

// 修改密码
router.put('/password', auth, async (req, res) => {
  const { oldPwd, newPwd } = req.body;
  const rows = await query('SELECT password FROM user WHERE id=?', [req.user.id]);
  if (!bcrypt.compareSync(oldPwd || '', rows[0].password))
    return res.status(400).json({ code: 400, msg: '原密码错误' });
  await query('UPDATE user SET password=? WHERE id=?', [bcrypt.hashSync(newPwd, 10), req.user.id]);
  res.json({ code: 0, msg: '密码修改成功' });
});

// ===== 收货地址 =====
router.get('/address', auth, async (req, res) => {
  const rows = await query('SELECT * FROM address WHERE user_id=? ORDER BY is_default DESC,id DESC', [req.user.id]);
  res.json({ code: 0, data: rows });
});

// 新增 / 修改地址共用的校验，避免绕过前端提交脏数据
function addressError(name, phone, detail) {
  if (!String(name == null ? '' : name).trim()) return '请填写收货人姓名';
  const pe = phoneError(phone, true);
  if (pe) return pe;
  if (!String(detail == null ? '' : detail).trim()) return '请填写详细地址';
  return '';
}

router.post('/address', auth, async (req, res) => {
  const { name, phone, detail, is_default } = req.body;
  const ae = addressError(name, phone, detail);
  if (ae) return res.status(400).json({ code: 400, msg: ae });
  if (is_default) await query('UPDATE address SET is_default=0 WHERE user_id=?', [req.user.id]);
  await query(
    'INSERT INTO address(user_id,name,phone,detail,is_default) VALUES(?,?,?,?,?)',
    [req.user.id, String(name).trim(), String(phone).trim(), String(detail).trim(), is_default ? 1 : 0]
  );
  res.json({ code: 0, msg: '地址已保存' });
});

router.put('/address/:id', auth, async (req, res) => {
  const { name, phone, detail, is_default } = req.body;
  const ae = addressError(name, phone, detail);
  if (ae) return res.status(400).json({ code: 400, msg: ae });
  if (is_default) await query('UPDATE address SET is_default=0 WHERE user_id=?', [req.user.id]);
  await query(
    'UPDATE address SET name=?,phone=?,detail=?,is_default=? WHERE id=? AND user_id=?',
    [String(name).trim(), String(phone).trim(), String(detail).trim(), is_default ? 1 : 0, req.params.id, req.user.id]
  );
  res.json({ code: 0, msg: '地址已更新' });
});

router.delete('/address/:id', auth, async (req, res) => {
  await query('DELETE FROM address WHERE id=? AND user_id=?', [req.params.id, req.user.id]);
  res.json({ code: 0, msg: '地址已删除' });
});

module.exports = router;
