const express = require('express');
const router = express.Router();
const { query } = require('../db');
const { adminAuth } = require('../middleware/auth');
const { cfInsight } = require('../services/recommend');
const { sensitiveError } = require('../utils/sensitive');

// 仪表盘统计
router.get('/stats', adminAuth, async (req, res) => {
  const users = await query('SELECT COUNT(*) c FROM user');
  const products = await query('SELECT COUNT(*) c FROM product');
  const orders = await query('SELECT COUNT(*) c, COALESCE(SUM(total),0) s FROM `order`');
  const msgs = await query('SELECT COUNT(*) c FROM message');
  res.json({ code: 0, data: { users: users[0].c, products: products[0].c, orders: orders[0].c, revenue: orders[0].s, messages: msgs[0].c } });
});

// ---------- 用户管理 ----------
// 列表带上 status：1=正常 0=已禁用。前端据此显示标签与「禁用/启用」按钮文案。
router.get('/users', adminAuth, async (req, res) => {
  const rows = await query(
    'SELECT id,username,nickname,email,phone,role,status,created_at FROM user ORDER BY id DESC'
  );
  res.json({ code: 0, data: rows });
});

// 修改角色：0=普通用户 1=卖家。只接受这两个值，避免前端传脏数据把 role 写成任意数字。
router.put('/user/:id/role', adminAuth, async (req, res) => {
  const role = Number(req.body && req.body.role);
  if (role !== 0 && role !== 1) {
    return res.status(400).json({ code: 400, msg: '角色只能是 0（普通用户）或 1（卖家）' });
  }
  const result = await query('UPDATE user SET role=? WHERE id=?', [role, req.params.id]);
  if (!result.affectedRows) {
    return res.status(404).json({ code: 404, msg: '用户不存在' });
  }
  res.json({ code: 0, msg: role === 1 ? '已设为卖家' : '已设为普通用户' });
});

/**
 * 禁用 / 启用用户
 * -----------------------------------------------------------------
 * 状态规则：
 *   status=0（禁用）→ 该账号无法登录；已签发的 token 会在 auth 中间件里被拒绝，
 *                     因此不必等 token 过期，禁用即刻生效。
 *   status=1（启用）→ 恢复正常，可立即重新登录。
 * 禁用只影响登录与写操作，不会删除该用户的商品、订单和历史消息。
 * 管理员与普通用户是两套账号体系（admin 表），这里改不到管理员自己。
 */
router.put('/user/:id/status', adminAuth, async (req, res) => {
  const status = Number(req.body && req.body.status);
  if (status !== 0 && status !== 1) {
    return res.status(400).json({ code: 400, msg: '状态只能是 0（禁用）或 1（正常）' });
  }

  const users = await query('SELECT id, nickname, status FROM user WHERE id=?', [req.params.id]);
  if (!users.length) {
    return res.status(404).json({ code: 404, msg: '用户不存在' });
  }

  const user = users[0];
  if (user.status === status) {
    // 重复点击同一个方向不算错误，直接回当前状态，前端不会弹红色报错
    return res.json({
      code: 0,
      msg: status === 0 ? '该用户已是禁用状态' : '该用户已是正常状态',
      data: { id: user.id, status },
    });
  }

  await query('UPDATE user SET status=? WHERE id=?', [status, user.id]);
  res.json({
    code: 0,
    msg: status === 0 ? `已禁用「${user.nickname || user.id}」` : `已启用「${user.nickname || user.id}」`,
    data: { id: user.id, status },
  });
});

// ---------- 商品管理 ----------
// 列表带出卖家昵称与状态，管理端「商品管理」表格直接用这份数据。
router.get('/products', adminAuth, async (req, res) => {
  const rows = await query(
    'SELECT p.*,u.nickname seller FROM product p LEFT JOIN user u ON p.seller_id=u.id ORDER BY p.id DESC'
  );
  res.json({ code: 0, data: rows });
});

/**
 * 商品上架 / 下架
 * -----------------------------------------------------------------
 * 状态规则（对应 product.status 字段）：
 *   1 = 在售：出现在首页列表、分类筛选、搜索结果、猜你喜欢、收藏夹
 *   0 = 下架：以上入口一律不再返回；直链访问商品详情页也会被拒绝
 * 下架不会删除数据，也不影响已产生的订单（订单里保存的是下单时的商品快照）。
 * 卖家重新上架后立即恢复可见。
 */
router.put('/product/:id/status', adminAuth, async (req, res) => {
  const status = Number(req.body && req.body.status);
  if (status !== 0 && status !== 1) {
    return res.status(400).json({ code: 400, msg: '状态只能是 0（下架）或 1（在售）' });
  }

  const products = await query('SELECT id, title, status FROM product WHERE id=?', [req.params.id]);
  if (!products.length) {
    return res.status(404).json({ code: 404, msg: '商品不存在或已被删除' });
  }

  const product = products[0];
  if (product.status === status) {
    return res.json({
      code: 0,
      msg: status === 0 ? '该商品已是下架状态' : '该商品已在售',
      data: { id: product.id, status },
    });
  }

  await query('UPDATE product SET status=? WHERE id=?', [status, product.id]);
  res.json({
    code: 0,
    msg: status === 0 ? `已下架「${product.title}」` : `已上架「${product.title}」`,
    data: { id: product.id, status },
  });
});

// ---------- 管理员私信 ----------
// 约定的数据模型：管理员发出的消息 from_id=0、sender_type=2。
// 不占用 user 表的任何 id，因此不会和真实用户串号；用户端会话列表里显示为「平台管理员」。

// 私信收件人候选：只返回 id / 账号 / 昵称 / 状态，够下拉框用即可，不回传密码等敏感字段
router.get('/message/users', adminAuth, async (req, res) => {
  const keyword = String((req.query && req.query.keyword) || '').trim();
  let rows;
  if (keyword) {
    const like = '%' + keyword + '%';
    rows = await query(
      `SELECT id, username, nickname, status FROM user
        WHERE username LIKE ? OR nickname LIKE ?
        ORDER BY id DESC LIMIT 50`,
      [like, like]
    );
  } else {
    rows = await query('SELECT id, username, nickname, status FROM user ORDER BY id DESC LIMIT 50');
  }
  res.json({ code: 0, data: rows });
});

// 发送私信给指定用户
router.post('/message/send', adminAuth, async (req, res) => {
  const toId = Number(req.body && req.body.to_id);
  const content = String((req.body && req.body.content) || '').trim();

  if (!toId) return res.status(400).json({ code: 400, msg: '请选择接收用户' });
  if (!content) return res.status(400).json({ code: 400, msg: '请填写私信内容' });
  if (content.length > 500) {
    return res.status(400).json({ code: 400, msg: `私信内容不能超过 500 字（当前 ${content.length} 字）` });
  }

  // 管理端发出的内容同样过一遍敏感词，避免后台成为绕开内容审核的入口
  const se = sensitiveError(content, '私信内容');
  if (se) return res.status(400).json({ code: 400, msg: se });

  const users = await query('SELECT id, nickname, status FROM user WHERE id=?', [toId]);
  if (!users.length) {
    return res.status(404).json({ code: 404, msg: '接收用户不存在' });
  }

  const user = users[0];
  await query(
    'INSERT INTO message(from_id,to_id,content,sender_type,product_id) VALUES(0,?,?,2,0)',
    [user.id, content]
  );

  // 收件人被禁用时不阻断发送（运营仍可能需要留痕），但明确告知对方可能看不到
  const disabled = user.status === 0;
  res.json({
    code: 0,
    msg: disabled ? '已发送，但该用户已被禁用，登录后才能看到' : '私信已发送',
    data: { to_id: user.id, nickname: user.nickname, disabled },
  });
});

// 与某个用户的往来记录（管理员发出的 + 该用户回复的），用于后台查看是否有回信
router.get('/message/history', adminAuth, async (req, res) => {
  const peerId = Number(req.query && req.query.to_id);
  if (!peerId) return res.status(400).json({ code: 400, msg: '请指定用户' });

  const rows = await query(
    `SELECT id, from_id, to_id, content, sender_type, is_read,
            DATE_FORMAT(created_at, '%Y-%m-%d %H:%i') created_at
       FROM message
      WHERE (from_id=0 AND to_id=?) OR (from_id=? AND to_id=0)
      ORDER BY created_at ASC, id ASC
      LIMIT 200`,
    [peerId, peerId]
  );
  res.json({ code: 0, data: rows });
});

// 公告（发布仅限管理员：走 adminAuth，普通用户拿不到 token 就 401/403）
router.get('/notices', adminAuth, async (req, res) => {
  const rows = await query(
    `SELECT id, title, content, DATE_FORMAT(created_at, '%Y-%m-%d %H:%i') created_at
     FROM notice ORDER BY id DESC`
  );
  res.json({ code: 0, data: rows });
});
router.post('/notice', adminAuth, async (req, res) => {
  const title = String((req.body && req.body.title) || '').trim();
  const content = String((req.body && req.body.content) || '').trim();
  if (!title) return res.status(400).json({ code: 400, msg: '请填写公告标题' });
  if (!content) return res.status(400).json({ code: 400, msg: '请填写公告内容' });
  await query('INSERT INTO notice(title,content) VALUES(?,?)', [title, content]);
  res.json({ code: 0, msg: '已发布' });
});
router.delete('/notice/:id', adminAuth, async (req, res) => {
  await query('DELETE FROM notice WHERE id=?', [req.params.id]);
  res.json({ code: 0, msg: '已删除' });
});

// 行为数据（验证协同过滤确实有数据喂入）
router.get('/interactions', adminAuth, async (req, res) => {
  const rows = await query(
    `SELECT i.*, u.nickname, p.title FROM interaction i
     LEFT JOIN user u ON i.user_id=u.id LEFT JOIN product p ON i.product_id=p.id
     ORDER BY i.id DESC LIMIT 300`
  );
  res.json({ code: 0, data: rows });
});

// 销量 / 成交额图表数据（类目分布 + 近 7 日走势）
router.get('/charts', adminAuth, async (req, res) => {
  try {
    const byCat = await query(
      `SELECT COALESCE(c.name,'未分类') name, COUNT(oi.id) cnt,
              COALESCE(SUM(oi.price * oi.quantity),0) amount
       FROM \`order\` o
       JOIN order_item oi ON oi.order_id = o.id
       LEFT JOIN product p ON p.id = oi.product_id
       LEFT JOIN category c ON c.id = p.category_id
       WHERE o.status >= 1
       GROUP BY COALESCE(c.name,'未分类')
       ORDER BY amount DESC`
    );
    const rows = await query(
      `SELECT DATE_FORMAT(o.created_at, '%Y-%m-%d') day, COUNT(DISTINCT o.id) cnt, COALESCE(SUM(o.total),0) amount
       FROM \`order\` o
       WHERE o.status >= 1 AND o.created_at >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)
       GROUP BY day ORDER BY day`
    );
    const map = new Map(rows.map(r => [String(r.day), r]));
    const byDay = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000);
      const key = d.toISOString().slice(0, 10);
      const hit = map.get(String(key)) || null;
      // MySQL 的 DATE 值可能被 mysql2 转成 Date，这里统一按 YYYY-MM-DD 处理
      byDay.push({
        day: key.slice(5),
        cnt: hit ? Number(hit.cnt) : 0,
        amount: hit ? Number(hit.amount) : 0
      });
    }
    res.json({ code: 0, data: { byCategory: byCat.map(r => ({ name: r.name, cnt: Number(r.cnt), amount: Number(r.amount) })), byDay } });
  } catch (e) {
    res.status(500).json({ code: 500, msg: '图表数据加载失败: ' + e.message });
  }
});

// 协同过滤算法「数据 + 举例」：把相似度、推荐依据真实算出来给后台看
router.get('/cf-insight', adminAuth, async (req, res) => {
  try {
    const data = await cfInsight(req.query.user_id);
    res.json({ code: 0, data });
  } catch (e) {
    res.status(500).json({ code: 500, msg: '算法数据加载失败: ' + e.message });
  }
});

module.exports = router;
