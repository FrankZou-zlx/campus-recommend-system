const express = require('express');
const router = express.Router();
const { query } = require('../db');

/**
 * 公告列表（公开接口：游客、普通用户、管理员都能看）
 * 发布走 /api/admin/notice（仅 adminAuth 通过的管理员可调用）。
 */
router.get('/list', async (req, res) => {
  try {
    const rows = await query(
      `SELECT id, title, content, DATE_FORMAT(created_at, '%Y-%m-%d %H:%i') created_at
       FROM notice ORDER BY id DESC LIMIT 50`
    );
    res.json({ code: 0, data: rows });
  } catch (e) {
    res.status(500).json({ code: 500, msg: '公告加载失败: ' + e.message });
  }
});

module.exports = router;
