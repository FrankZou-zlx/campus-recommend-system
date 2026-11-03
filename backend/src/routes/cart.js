const express = require('express');
const router = express.Router();
const { query } = require('../db');
const { auth } = require('../middleware/auth');

// 单件商品在购物车里的数量上限，与下单接口保持一致
const MAX_QTY_PER_ITEM = 99;

/**
 * 把前端传来的数量归一成 1~99 的整数。
 * 不接受负数、0、小数、字符串数字以外的任何值 —— 返回 null 表示不合法。
 * 之所以要显式转换：exist.quantity 是数字，若 quantity 传成字符串 "3"，
 * 直接相加会得到 "23"（字符串拼接）而不是 6。
 */
function normalizeQuantity(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > MAX_QTY_PER_ITEM) return null;
  return value;
}

// 加入购物车（记录 cart 行为）
router.post('/add', auth, async (req, res) => {
  const { product_id } = req.body;
  // 不传数量时默认加 1 件
  const rawQty = req.body && req.body.quantity !== undefined ? req.body.quantity : 1;
  const addQty = normalizeQuantity(rawQty);
  if (addQty === null) {
    return res.status(400).json({ code: 400, msg: `数量需为 1~${MAX_QTY_PER_ITEM} 的整数` });
  }

  const [p] = await query('SELECT id,status,stock FROM product WHERE id=?', [product_id]);
  if (!p) return res.status(404).json({ code: 404, msg: '商品不存在' });
  if (p.status !== 1) return res.status(400).json({ code: 400, msg: '商品已下架' });

  const [exist] = await query('SELECT id,quantity FROM cart WHERE user_id=? AND product_id=?', [req.user.id, product_id]);
  const nextQty = (exist ? Number(exist.quantity) : 0) + addQty;
  if (nextQty > Number(p.stock)) {
    return res.status(400).json({
      code: 400,
      msg: `库存不足：当前库存 ${p.stock} 件${exist ? `，购物车已有 ${exist.quantity} 件` : ''}`,
    });
  }
  if (nextQty > MAX_QTY_PER_ITEM) {
    return res.status(400).json({ code: 400, msg: `同一商品最多加入 ${MAX_QTY_PER_ITEM} 件` });
  }

  if (exist) {
    await query('UPDATE cart SET quantity=? WHERE id=?', [nextQty, exist.id]);
  } else {
    await query('INSERT INTO cart(user_id,product_id,quantity) VALUES(?,?,?)', [req.user.id, product_id, addQty]);
  }

  // 记录用户行为
  const [it] = await query('SELECT id FROM interaction WHERE user_id=? AND product_id=? AND type=?', [req.user.id, product_id, 'cart']);
  if (it) await query('UPDATE interaction SET score=4 WHERE id=?', [it.id]);
  else await query('INSERT INTO interaction(user_id,product_id,type,score) VALUES(?,?,?,?)', [req.user.id, product_id, 'cart', 4]);
  res.json({ code: 0, msg: '已加入购物车', data: { quantity: nextQty } });
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

// 修改数量：必须校验下架状态与库存，否则可以改到远超库存，结算时才失败
router.put('/update/:id', auth, async (req, res) => {
  const qty = normalizeQuantity(req.body && req.body.quantity);
  if (qty === null) {
    return res.status(400).json({ code: 400, msg: `数量需为 1~${MAX_QTY_PER_ITEM} 的整数` });
  }

  const [row] = await query(
    `SELECT c.id, p.stock, p.status FROM cart c
     JOIN product p ON p.id = c.product_id
     WHERE c.id=? AND c.user_id=?`,
    [req.params.id, req.user.id]
  );
  if (!row) return res.status(404).json({ code: 404, msg: '购物车条目不存在' });
  if (Number(row.status) !== 1) return res.status(400).json({ code: 400, msg: '商品已下架，请从购物车移除' });
  if (qty > Number(row.stock)) {
    return res.status(400).json({ code: 400, msg: `库存不足，当前仅剩 ${row.stock} 件` });
  }

  await query('UPDATE cart SET quantity=? WHERE id=? AND user_id=?', [qty, req.params.id, req.user.id]);
  res.json({ code: 0, msg: '已更新', data: { quantity: qty } });
});

// 删除
router.delete('/:id', auth, async (req, res) => {
  await query('DELETE FROM cart WHERE id=? AND user_id=?', [req.params.id, req.user.id]);
  res.json({ code: 0, msg: '已删除' });
});

module.exports = router;
