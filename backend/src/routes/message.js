const express = require('express');
const router = express.Router();
const { query } = require('../db');
const { auth } = require('../middleware/auth');
const { sensitiveError } = require('../utils/sensitive');

// 发送私信
router.post('/send', auth, async (req, res) => {
  const { to_id, content } = req.body;
  if (!to_id || !content) return res.status(400).json({ code: 400, msg: '收件人和内容必填' });
  const se = sensitiveError(content, '私信内容');
  if (se) return res.status(400).json({ code: 400, msg: se });
  await query('INSERT INTO message(from_id,to_id,content) VALUES(?,?,?)', [req.user.id, to_id, content]);
  res.json({ code: 0, msg: '发送成功' });
});

// 与某人的对话列表
router.get('/talk/:userId', auth, async (req, res) => {
  const uid = req.user.id, oid = req.params.userId;
  const rows = await query(
    'SELECT * FROM message WHERE (from_id=? AND to_id=?) OR (from_id=? AND to_id=?) ORDER BY created_at ASC',
    [uid, oid, oid, uid]
  );
  res.json({ code: 0, data: rows });
});

// 我的会话列表（按最近联系人聚合）
router.get('/contacts', auth, async (req, res) => {
  const uid = req.user.id;
  const rows = await query(
    `SELECT c.partner_id AS contact_id, u.nickname, u.avatar,
            (SELECT content FROM message m2
               WHERE (m2.from_id=? AND m2.to_id=c.partner_id)
                  OR (m2.from_id=c.partner_id AND m2.to_id=?)
               ORDER BY m2.created_at DESC LIMIT 1) AS last_msg,
            (SELECT created_at FROM message m3
               WHERE (m3.from_id=? AND m3.to_id=c.partner_id)
                  OR (m3.from_id=c.partner_id AND m3.to_id=?)
               ORDER BY m3.created_at DESC LIMIT 1) AS last_time
     FROM (SELECT DISTINCT CASE WHEN m.from_id=? THEN m.to_id ELSE m.from_id END AS partner_id
           FROM message m WHERE m.from_id=? OR m.to_id=?) c
     JOIN user u ON u.id = c.partner_id
     ORDER BY last_time DESC`,
    [uid, uid, uid, uid, uid, uid, uid]
  );
  res.json({ code: 0, data: rows });
});

// 标记已读
router.put('/read/:fromId', auth, async (req, res) => {
  await query('UPDATE message SET is_read=1 WHERE to_id=? AND from_id=?', [req.user.id, req.params.fromId]);
  res.json({ code: 0, msg: 'ok' });
});

module.exports = router;
