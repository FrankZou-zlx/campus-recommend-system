const express = require('express');
const router = express.Router();
const { query } = require('../db');
const { adminAuth } = require('../middleware/auth');
const { cfInsight } = require('../services/recommend');

// 仪表盘统计
router.get('/stats', adminAuth, async (req, res) => {
  const users = await query('SELECT COUNT(*) c FROM user');
  const products = await query('SELECT COUNT(*) c FROM product');
  const orders = await query('SELECT COUNT(*) c, COALESCE(SUM(total),0) s FROM `order`');
  const msgs = await query('SELECT COUNT(*) c FROM message');
  res.json({ code: 0, data: { users: users[0].c, products: products[0].c, orders: orders[0].c, revenue: orders[0].s, messages: msgs[0].c } });
});

// 用户管理
router.get('/users', adminAuth, async (req, res) => {
  const rows = await query('SELECT id,username,nickname,email,phone,role,created_at FROM user ORDER BY id DESC');
  res.json({ code: 0, data: rows });
});
router.put('/user/:id/role', adminAuth, async (req, res) => {
  const { role } = req.body;
  await query('UPDATE user SET role=? WHERE id=?', [role, req.params.id]);
  res.json({ code: 0, msg: 'ok' });
});

// 商品管理（含上下架）
router.get('/products', adminAuth, async (req, res) => {
  const rows = await query('SELECT p.*,u.nickname seller FROM product p LEFT JOIN user u ON p.seller_id=u.id ORDER BY p.id DESC');
  res.json({ code: 0, data: rows });
});
router.put('/product/:id/status', adminAuth, async (req, res) => {
  const { status } = req.body;
  await query('UPDATE product SET status=? WHERE id=?', [status, req.params.id]);
  res.json({ code: 0, msg: 'ok' });
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
