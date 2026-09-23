const express = require('express');
const router = express.Router();
const { query } = require('../db');
const { auth } = require('../middleware/auth');

// 记录一次搜索（登录用户才记，游客不入库）
router.post('/log', auth, async (req, res) => {
  try {
    const keyword = String((req.body && req.body.keyword) || '').trim().slice(0, 30);
    if (!keyword) return res.json({ code: 0 });
    await query('INSERT INTO search_log(user_id,keyword) VALUES(?,?)', [req.user.id, keyword]);
    res.json({ code: 0 });
  } catch (e) {
    res.status(500).json({ code: 500, msg: '记录失败: ' + e.message });
  }
});

// 我的搜索历史（去重后按时间倒序）
router.get('/mine', auth, async (req, res) => {
  const rows = await query(
    `SELECT keyword, MAX(created_at) t FROM search_log
     WHERE user_id=? GROUP BY keyword ORDER BY t DESC LIMIT ?`,
    [req.user.id, parseInt(req.query.limit) || 8]
  );
  res.json({ code: 0, data: rows.map(r => r.keyword) });
});

// 全站热搜词（公开）
router.get('/hot', async (req, res) => {
  const rows = await query(
    `SELECT keyword, COUNT(*) c FROM search_log
     WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
     GROUP BY keyword ORDER BY c DESC, MAX(created_at) DESC LIMIT ?`,
    [parseInt(req.query.limit) || 8]
  );
  res.json({ code: 0, data: rows.map(r => ({ keyword: r.keyword, count: r.c })) });
});

module.exports = router;
