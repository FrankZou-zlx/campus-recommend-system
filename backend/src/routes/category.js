const express = require('express');
const router = express.Router();
const { query } = require('../db');

// 分类列表（全部）
router.get('/list', async (req, res) => {
  const rows = await query('SELECT * FROM category ORDER BY sort ASC, id ASC');
  res.json({ code: 0, data: rows });
});

// 新增分类（普通用户也可发布商品，这里简单开放）
router.post('/add', async (req, res) => {
  const { name, parent_id, sort } = req.body;
  if (!name) return res.status(400).json({ code: 400, msg: '分类名必填' });
  await query('INSERT INTO category(name,parent_id,sort) VALUES(?,?,?)', [name, parent_id || 0, sort || 0]);
  res.json({ code: 0, msg: '分类已添加' });
});

module.exports = router;
