const express = require('express');
const router = express.Router();
const { query } = require('../db');
const { auth } = require('../middleware/auth');

// 加入购物车（记录 cart 行为）
router.post('/add', auth, async (req, res) => {
  const { product_id, quantity } = req.body;
  const [p] = await query('SELECT id,status,stock FROM product WHERE id=?', [product_id]);
  if (!p) return res.status(404).json({ code: 404, msg: '商品不存在' });
  if (p.status !== 1) return res.status(400).json({ code: 400, msg: '商品已下架' });
  const [exist] = await query('SELECT id,quantity FROM cart WHERE user_id=? AND product_id=?', [req.user.id, product_id]);
  if (exist) {
    await query('UPDATE cart SET quantity=? WHERE id=?', [exist.quantity + (quantity || 1), exist.id]);
  } else {
    await query('INSERT INTO cart(user_id,product_id,quantity) VALUES(?,?,?)', [req.user.id, product_id, quantity || 1]);
  }
  // 记录用户行为
  const [it] = await query('SELECT id FROM interaction WHERE user_id=? AND product_id=? AND type=?', [req.user.id, product_id, 'cart']);
  if (it) await query('UPDATE interaction SET score=4 WHERE id=?', [it.id]);
  else await query('INSERT INTO interaction(user_id,product_id,type,score) VALUES(?,?,?,?)', [req.user.id, product_id, 'cart', 4]);
  res.json({ code: 0, msg: '已加入购物车' });
});

// 购物车列表
router.get('/list', auth, async (req, res) => {
  const rows = await query(
    `SELECT c.id,c.quantity,c.product_id,p.title,p.price,p.cover,p.stock,p.status
     FROM cart c JOIN product p ON c.product_id=p.id WHERE c.user_id=? ORDER BY c.id DESC`,
    [req.user.id]
  );
  res.json({ code: 0, data: rows });
});

// 修改数量
router.put('/update/:id', auth, async (req, res) => {
  const { quantity } = req.body;
  await query('UPDATE cart SET quantity=? WHERE id=? AND user_id=?', [quantity, req.params.id, req.user.id]);
  res.json({ code: 0, msg: '已更新' });
});

// 删除
router.delete('/:id', auth, async (req, res) => {
  await query('DELETE FROM cart WHERE id=? AND user_id=?', [req.params.id, req.user.id]);
  res.json({ code: 0, msg: '已删除' });
});

module.exports = router;
