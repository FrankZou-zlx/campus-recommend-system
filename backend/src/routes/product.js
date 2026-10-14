const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { query } = require('../db');
const { auth } = require('../middleware/auth');
const { pinyin } = require('pinyin-pro');

// 中文标题转拼音（全拼 + 首字母），用于支持拼音搜索（如 baoshi→保湿、smh→面膜）
function toPinyin(title) {
  const t = String(title || '');
  const full = pinyin(t, { toneType: 'none', type: 'array' }).join('').toLowerCase();
  const init = pinyin(t, { pattern: 'first', toneType: 'none', type: 'array' }).join('').toLowerCase();
  return { full, init };
}

// 图片上传配置：存到 backend/uploads/products
const uploadDir = path.join(__dirname, '..', '..', 'uploads', 'products');
fs.mkdirSync(uploadDir, { recursive: true });
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + Math.round(Math.random() * 1e6) + path.extname(file.originalname))
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

// 记录用户行为（供推荐算法使用），重复则更新权重
async function recordInteraction(userId, productId, type, score) {
  if (!userId) return;
  const exist = await query(
    'SELECT id,score FROM interaction WHERE user_id=? AND product_id=? AND type=?',
    [userId, productId, type]
  );
  if (exist.length) {
    await query('UPDATE interaction SET score=? WHERE id=?', [score, exist[0].id]);
  } else {
    await query('INSERT INTO interaction(user_id,product_id,type,score) VALUES(?,?,?,?)', [userId, productId, type, score]);
  }
}

// 商品列表（公开，支持分类/关键词/分页）
router.get('/list', async (req, res) => {
  const { category_id, keyword, page = 1, size = 12 } = req.query;
  const where = ['status=1'];
  const params = [];
  if (category_id) { where.push('p.category_id=?'); params.push(category_id); }
  // 多个关键词（空格/逗号分隔）：命中任意一个即返回；命中的关键词越多排得越靠前（全命中优先）
  const terms = String(keyword || '').split(/[\s,，、;；]+/).map((t) => t.trim()).filter(Boolean).slice(0, 5);
  const termParams = [];           // SELECT 里算命中数用
  let hitExpr = '0';
  if (terms.length) {
    const parts = terms.map(() => '(p.title LIKE ? OR p.description LIKE ? OR c.name LIKE ? OR p.title_pinyin LIKE ? OR p.title_initials LIKE ?)');
    where.push('(' + parts.join(' OR ') + ')');
    terms.forEach((t) => {
      const like = '%' + t + '%';
      params.push(like, like, like, like, like);
      termParams.push(like, like, like, like, like);
    });
    hitExpr = parts.map((p) => '(' + p + ')').join(' + ');
  }
  const offset = (parseInt(page) - 1) * parseInt(size);
  const sql = `SELECT p.*, c.name AS category_name, u.nickname AS seller_name, (${hitExpr}) AS hit_count
               FROM product p LEFT JOIN category c ON p.category_id=c.id
               LEFT JOIN user u ON p.seller_id=u.id
               WHERE ${where.join(' AND ')} ORDER BY hit_count DESC, p.created_at DESC LIMIT ? OFFSET ?`;
  const rows = await query(sql, [...termParams, ...params, parseInt(size), offset]);
  // 计数也要 JOIN 分类表（关键词可能命中分类名）
  const [totalRow] = await query(`SELECT COUNT(*) AS cnt FROM product p LEFT JOIN category c ON p.category_id=c.id WHERE ${where.join(' AND ')}`, params);
  res.json({ code: 0, data: { list: rows, total: totalRow.cnt } });
});

// 商品详情（公开，登录用户浏览时记录 view 行为）
router.get('/detail/:id', auth, async (req, res) => {
  const id = req.params.id;
  const [p] = await query(
    `SELECT p.*, c.name AS category_name, u.nickname AS seller_name
     FROM product p LEFT JOIN category c ON p.category_id=c.id
     LEFT JOIN user u ON p.seller_id=u.id WHERE p.id=?`, [id]
  );
  if (!p) return res.status(404).json({ code: 404, msg: '商品不存在' });
  const images = await query('SELECT url FROM product_image WHERE product_id=?', [id]);
  p.images = images.map(i => i.url);
  // 登录用户记录浏览行为
  await recordInteraction(req.user.id, id, 'view', 1);
  res.json({ code: 0, data: p });
});

// 发布商品（需登录）
router.post('/publish', auth, upload.single('cover'), async (req, res) => {
  const { title, description, price, stock, category_id } = req.body;
  if (!title || !price) return res.status(400).json({ code: 400, msg: '标题和价格必填' });
  // 前端先用 /product/image 上传拿到 url 列表，再随发布一起提交
  let imgs = [];
  try { imgs = req.body.images ? JSON.parse(req.body.images) : []; } catch (e) { imgs = []; }
  if (!Array.isArray(imgs)) imgs = [];
  const cover = req.file ? '/uploads/products/' + req.file.filename : (imgs[0] || '');
  // 分类必须真实存在，否则商品会变成"孤儿"（列表里永远显示未分类、按分类也筛不出来）
  const catId = Number(category_id) || 0;
  if (!catId) return res.status(400).json({ code: 400, msg: '请选择商品分类' });
  const [cat] = await query('SELECT id FROM category WHERE id=?', [catId]);
  if (!cat) return res.status(400).json({ code: 400, msg: '所选分类不存在，请重新选择' });
  const py = toPinyin(title);
  const r = await query(
    'INSERT INTO product(seller_id,category_id,title,description,price,stock,cover,title_pinyin,title_initials) VALUES(?,?,?,?,?,?,?,?,?)',
    [req.user.id, catId, title, description || '', price, stock || 1, cover, py.full, py.init]
  );
  for (const u of imgs) {
    if (u) await query('INSERT INTO product_image(product_id,url) VALUES(?,?)', [r.insertId, u]);
  }
  res.json({ code: 0, msg: '发布成功', data: { id: r.insertId } });
});

// 编辑商品（仅发布者）
router.put('/update/:id', auth, upload.single('cover'), async (req, res) => {
  const { title, description, price, stock, category_id, status } = req.body;
  const [own] = await query('SELECT id FROM product WHERE id=? AND seller_id=?', [req.params.id, req.user.id]);
  if (!own) return res.status(403).json({ code: 403, msg: '无权限' });
  const catId = Number(category_id) || 0;
  if (!catId) return res.status(400).json({ code: 400, msg: '请选择商品分类' });
  const [cat] = await query('SELECT id FROM category WHERE id=?', [catId]);
  if (!cat) return res.status(400).json({ code: 400, msg: '所选分类不存在，请重新选择' });
  const coverSql = req.file ? ',cover=?' : '';
  const py = toPinyin(title);
  const params = [title, description || '', price, stock || 1, catId, status ?? 1, py.full, py.init];
  if (req.file) params.splice(5, 0, '/uploads/products/' + req.file.filename);
  params.push(req.params.id);
  await query(`UPDATE product SET title=?,description=?,price=?,stock=?,category_id=?,status=?,title_pinyin=?,title_initials=? ${coverSql} WHERE id=?`, params);
  res.json({ code: 0, msg: '更新成功' });
});

// 删除商品（仅发布者）
router.delete('/:id', auth, async (req, res) => {
  const [own] = await query('SELECT id FROM product WHERE id=? AND seller_id=?', [req.params.id, req.user.id]);
  if (!own) return res.status(403).json({ code: 403, msg: '无权限' });
  await query('DELETE FROM product WHERE id=?', [req.params.id]);
  await query('DELETE FROM interaction WHERE product_id=?', [req.params.id]);
  res.json({ code: 0, msg: '已删除' });
});

// 上传商品图片（多图，返回 url 列表）
router.post('/image', auth, upload.array('images', 6), async (req, res) => {
  const product_id = req.body.product_id;
  const urls = [];
  for (const f of (req.files || [])) {
    const url = '/uploads/products/' + f.filename;
    urls.push(url);
    if (product_id) await query('INSERT INTO product_image(product_id,url) VALUES(?,?)', [product_id, url]);
  }
  res.json({ code: 0, data: urls });
});

// 收藏商品（记录 favorite 行为）
router.post('/favorite/:id', auth, async (req, res) => {
  await recordInteraction(req.user.id, req.params.id, 'favorite', 3);
  res.json({ code: 0, msg: '已收藏' });
});

// 我的收藏（取当前用户收藏过的在售商品）
router.get('/favorites', auth, async (req, res) => {
  const rows = await query(
    `SELECT p.id, p.title, p.price, p.cover, p.category_id, c.name AS category_name
     FROM product p LEFT JOIN category c ON p.category_id = c.id
     WHERE p.status = 1
       AND p.id IN (SELECT product_id FROM interaction WHERE user_id = ? AND type = 'favorite')
     ORDER BY p.created_at DESC`,
    [req.user.id]
  );
  res.json({ code: 0, data: rows });
});

module.exports = router;
