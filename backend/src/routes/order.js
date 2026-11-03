const express = require('express');
const router = express.Router();
const { query, pool } = require('../db');
const { auth } = require('../middleware/auth');

const MAX_ITEMS = 20;          // 一次最多结算多少种商品
const MAX_QTY_PER_ITEM = 99;   // 单个商品一次最多买多少件

// 生成订单号
function genOrderNo() {
  const d = new Date();
  const pad = n => ('' + n).padStart(2, '0');
  return '' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) +
    pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds()) + Math.floor(Math.random() * 1000);
}

/**
 * 业务异常：message 可以原样给用户看。
 * 与数据库异常区分开，避免把 SQL 报错原文回传给前端。
 */
function bizError(message) {
  const error = new Error(message);
  error.isBusiness = true;
  return error;
}

/**
 * 校验并规整下单明细
 * ---------------------------------------------------------------------------
 * 前端传来的数量不可信：直接透传会出现 quantity=-5 让库存反向增加、
 * 或者 "3" 这样的字符串让价格算出 NaN。这里统一收口：
 *   1. product_id / quantity 必须是正整数；
 *   2. quantity 限制在 1~99，防止一次性把库存清空或写入异常值；
 *   3. 同一商品重复出现时合并数量，避免同一订单里两次扣减绕过库存检查。
 * 返回 { items } 或 { error }。
 */
function normalizeItems(rawItems) {
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    return { error: '订单为空' };
  }
  if (rawItems.length > MAX_ITEMS) {
    return { error: `一次最多结算 ${MAX_ITEMS} 种商品` };
  }

  const merged = new Map();
  for (const item of rawItems) {
    const productId = Number(item && item.product_id);
    const quantity = Number(item && item.quantity);
    if (!Number.isInteger(productId) || productId <= 0) {
      return { error: '商品参数不合法' };
    }
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QTY_PER_ITEM) {
      return { error: `购买数量需为 1~${MAX_QTY_PER_ITEM} 的整数` };
    }
    merged.set(productId, (merged.get(productId) || 0) + quantity);
  }

  const items = [];
  for (const [productId, quantity] of merged) {
    if (quantity > MAX_QTY_PER_ITEM) {
      return { error: `同一商品一次最多购买 ${MAX_QTY_PER_ITEM} 件` };
    }
    items.push({ product_id: productId, quantity });
  }
  return { items };
}

// 结算下单（从购物车选中的商品）
router.post('/create', auth, async (req, res) => {
  const checked = normalizeItems(req.body && req.body.items);
  if (checked.error) {
    return res.status(400).json({ code: 400, msg: checked.error });
  }
  const items = checked.items;
  const addressId = Number(req.body && req.body.address_id) || 0;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    let total = 0;
    const orderNo = genOrderNo();
    const [created] = await conn.query(
      'INSERT INTO `order`(order_no,user_id,total,status,address_id) VALUES(?,?,?,0,?)',
      [orderNo, req.user.id, 0, addressId]
    );
    const orderId = created.insertId;

    for (const item of items) {
      // FOR UPDATE：同一商品的并发下单在此串行化，避免两单同时读到「还有 1 件」而超卖
      const [rows] = await conn.query(
        'SELECT id,title,price,stock,status,seller_id FROM product WHERE id=? FOR UPDATE',
        [item.product_id]
      );
      const product = rows[0];
      if (!product || Number(product.status) !== 1) {
        throw bizError('商品[' + (product ? product.title : item.product_id) + ']不可购买');
      }
      if (Number(product.seller_id) === Number(req.user.id)) {
        throw bizError(`不能购买自己发布的商品[${product.title}]`);
      }
      if (Number(product.stock) < item.quantity) {
        throw bizError(`商品[${product.title}]库存不足，仅剩 ${product.stock} 件`);
      }

      const subtotal = Number(product.price) * item.quantity;
      total += subtotal;
      await conn.query(
        'INSERT INTO order_item(order_id,product_id,title,price,quantity) VALUES(?,?,?,?,?)',
        [orderId, product.id, product.title, product.price, item.quantity]
      );
      await conn.query('UPDATE product SET stock=stock-? WHERE id=?', [item.quantity, product.id]);
      // 记录购买行为（最高权重）
      await conn.query(
        'INSERT INTO interaction(user_id,product_id,type,score) VALUES(?,?,?,?) ON DUPLICATE KEY UPDATE score=5',
        [req.user.id, product.id, 'buy', 5]
      );
    }

    await conn.query('UPDATE `order` SET total=? WHERE id=?', [total, orderId]);
    // 清空已购购物车项
    await conn.query(
      'DELETE FROM cart WHERE user_id=? AND product_id IN (?)',
      [req.user.id, items.map(i => i.product_id)]
    );
    await conn.commit();
    res.json({ code: 0, msg: '下单成功', data: { order_id: orderId, order_no: orderNo, total } });
  } catch (e) {
    await conn.rollback();
    const msg = e.isBusiness ? e.message : '下单失败，请稍后重试';
    if (!e.isBusiness) console.error('[order/create] 失败：', e.message);
    res.status(400).json({ code: 400, msg });
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
  if (!chk) return res.status(403).json({ code: 403, msg: '您不是本单商品的卖家，无法发货' });
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

/**
 * 买家取消订单（0 待付款 → 4 已取消）
 * ---------------------------------------------------------------------------
 * 下单时已经扣过库存，取消就必须把库存还给商品，否则每取消一单商品就凭空少几件，
 * 演示时反复「下单→取消」会把库存刷到 0。
 * 放在事务里：回补库存与改状态要么都成功，要么都不生效。
 */
router.put('/cancel/:id', auth, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    // FOR UPDATE：防止同一订单被并发取消两次，导致库存被回补两遍
    const [orders] = await conn.query(
      'SELECT id,status FROM `order` WHERE id=? AND user_id=? FOR UPDATE',
      [req.params.id, req.user.id]
    );
    const order = orders[0];
    if (!order) throw bizError('订单不存在');
    if (Number(order.status) !== 0) throw bizError('该订单当前不可取消（仅未付款订单可取消）');

    const [items] = await conn.query(
      'SELECT product_id,quantity FROM order_item WHERE order_id=?',
      [order.id]
    );
    for (const item of items) {
      // 商品可能已被卖家删除，此时库存无处可还，跳过即可，不影响取消
      await conn.query('UPDATE product SET stock=stock+? WHERE id=?', [item.quantity, item.product_id]);
    }

    await conn.query('UPDATE `order` SET status=4 WHERE id=?', [order.id]);
    await conn.commit();
    res.json({ code: 0, msg: '已取消，库存已返还' });
  } catch (e) {
    await conn.rollback();
    const msg = e.isBusiness ? e.message : '取消失败，请稍后重试';
    if (!e.isBusiness) console.error('[order/cancel] 失败：', e.message);
    res.status(400).json({ code: 400, msg });
  } finally {
    conn.release();
  }
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
