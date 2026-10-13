const express = require('express');
const router = express.Router();
const { query } = require('../db');
const { auth } = require('../middleware/auth');

// 生成订单号
function genOrderNo() {
  const d = new Date();
  const pad = n => ('' + n).padStart(2, '0');
  return '' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) +
    pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds()) + Math.floor(Math.random() * 1000);
}

// 结算下单（从购物车选中的商品）
router.post('/create', auth, async (req, res) => {
  const { items, address_id } = req.body; // items: [{product_id, quantity}]
  if (!items || !items.length) return res.status(400).json({ code: 400, msg: '订单为空' });
  const conn = await (await require('../db').pool).getConnection();
  try {
    await conn.beginTransaction();
    let total = 0;
    const orderNo = genOrderNo();
    const [or] = await conn.query(
      'INSERT INTO `order`(order_no,user_id,total,status,address_id) VALUES(?,?,?,0,?)',
      [orderNo, req.user.id, 0, address_id || 0]
    );
    const orderId = or.insertId;
    for (const it of items) {
      const [p] = await conn.query('SELECT id,title,price,stock,status FROM product WHERE id=?', [it.product_id]);
      if (!p.length || p[0].status !== 1) throw new Error('商品[' + (p[0]?.title || it.product_id) + ']不可购买');
      if (p[0].stock < it.quantity) throw new Error('商品[' + p[0].title + ']库存不足');
      const subtotal = Number(p[0].price) * it.quantity;
      total += subtotal;
      await conn.query(
        'INSERT INTO order_item(order_id,product_id,title,price,quantity) VALUES(?,?,?,?,?)',
        [orderId, p[0].id, p[0].title, p[0].price, it.quantity]
      );
      await conn.query('UPDATE product SET stock=stock-? WHERE id=?', [it.quantity, p[0].id]);
      // 记录购买行为（最高权重）
      await conn.query(
        'INSERT INTO interaction(user_id,product_id,type,score) VALUES(?,?,?,?) ON DUPLICATE KEY UPDATE score=5',
        [req.user.id, p[0].id, 'buy', 5]
      );
    }
    await conn.query('UPDATE `order` SET total=? WHERE id=?', [total, orderId]);
    // 清空已购购物车项
    await conn.query('DELETE FROM cart WHERE user_id=? AND product_id IN (?)', [req.user.id, items.map(i => i.product_id)]);
    await conn.commit();
    res.json({ code: 0, msg: '下单成功', data: { order_id: orderId, order_no: orderNo, total } });
  } catch (e) {
    await conn.rollback();
    res.status(400).json({ code: 400, msg: e.message });
  } finally {
    conn.release();
  }
});

// 我的订单列表
router.get('/list', auth, async (req, res) => {
  const { status } = req.query;
  const params = [req.user.id];
  let sql = 'SELECT * FROM `order` WHERE user_id=?';
  if (status !== undefined && status !== '') { sql += ' AND status=?'; params.push(status); }
  sql += ' ORDER BY created_at DESC';
  const orders = await query(sql, params);
  for (const o of orders) {
    o.items = await query('SELECT * FROM order_item WHERE order_id=?', [o.id]);
  }
  res.json({ code: 0, data: orders });
});

// 买家付款（0 待付款 → 1 已付款·待发货）
router.put('/pay/:id', auth, async (req, res) => {
  const r = await query('UPDATE `order` SET status=1 WHERE id=? AND user_id=? AND status=0', [req.params.id, req.user.id]);
  if (r.affectedRows === 0) return res.status(400).json({ code: 400, msg: '该订单当前不可付款（可能已付款或不存在）' });
  res.json({ code: 0, msg: '付款成功' });
});

// 卖家发货（1 已付款 → 2 已发货·待收货）；需校验当前用户确为该订单商品的卖家
router.put('/ship/:id', auth, async (req, res) => {
  const [chk] = await query(
    `SELECT 1 FROM order_item oi JOIN product p ON p.id=oi.product_id
     WHERE oi.order_id=? AND p.seller_id=? LIMIT 1`,
    [req.params.id, req.user.id]
  );
  if (!chk.length) return res.status(403).json({ code: 403, msg: '您不是本单商品的卖家，无法发货' });
  const r = await query('UPDATE `order` SET status=2, shipped_at=NOW() WHERE id=? AND status=1', [req.params.id]);
  if (r.affectedRows === 0) return res.status(400).json({ code: 400, msg: '该订单当前不可发货（需为已付款状态）' });
  res.json({ code: 0, msg: '已发货' });
});

// 买家确认收货（2 已发货 → 3 已完成）
router.put('/confirm/:id', auth, async (req, res) => {
  const r = await query('UPDATE `order` SET status=3, finished_at=NOW() WHERE id=? AND user_id=? AND status=2', [req.params.id, req.user.id]);
  if (r.affectedRows === 0) return res.status(400).json({ code: 400, msg: '该订单当前不可确认收货（需为已发货状态）' });
  res.json({ code: 0, msg: '已确认收货' });
});

// 买家取消订单（0 待付款 → 4 已取消）
router.put('/cancel/:id', auth, async (req, res) => {
  const r = await query('UPDATE `order` SET status=4 WHERE id=? AND user_id=? AND status=0', [req.params.id, req.user.id]);
  if (r.affectedRows === 0) return res.status(400).json({ code: 400, msg: '该订单当前不可取消（仅未付款订单可取消）' });
  res.json({ code: 0, msg: '已取消' });
});

// 我卖出的（商户视角）：当前用户发布的商品被下单的订单，并带买家收货地址
router.get('/sold', auth, async (req, res) => {
  const orders = await query(
    `SELECT DISTINCT o.*, a.name AS buyer_name, a.phone AS buyer_phone, a.detail AS buyer_address
     FROM \`order\` o
     JOIN order_item oi ON oi.order_id = o.id
     JOIN product p ON p.id = oi.product_id
     LEFT JOIN address a ON a.id = o.address_id
     WHERE p.seller_id = ?
     ORDER BY o.created_at DESC`,
    [req.user.id]
  );
  for (const o of orders) {
    o.items = await query('SELECT * FROM order_item WHERE order_id=?', [o.id]);
  }
  res.json({ code: 0, data: orders });
});

module.exports = router;
