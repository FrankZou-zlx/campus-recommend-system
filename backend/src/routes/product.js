const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { query } = require('../db');
const { auth } = require('../middleware/auth');
const { pinyin } = require('pinyin-pro');
const { sensitiveError } = require('../utils/sensitive');
const { isRealImage, removeQuietly } = require('../utils/image-check');

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

// 只允许真正的位图：扩展名与 MIME 必须同时命中白名单。
// 这两项都由客户端提供，能被伪造，所以落盘后还会再验一次文件头（见 verifyUploadedImages）。
const ALLOWED_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp']);
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

function imageFileFilter(req, file, cb) {
  const ext = path.extname(file.originalname || '').toLowerCase();
  const mime = String(file.mimetype || '').toLowerCase();
  if (!ALLOWED_EXT.has(ext) || !ALLOWED_MIME.has(mime)) {
    const error = new Error('只允许上传 JPG / PNG / GIF / WEBP 格式的图片');
    error.isUploadError = true;
    return cb(error);
  }
  cb(null, true);
}

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: imageFileFilter,
});

/**
 * 把上传中间件包一层，把 multer 的错误转成统一的 JSON 响应。
 * 不包装的话，类型不符、超限都会落到全局错误处理，用户看到 500「服务器错误」。
 * 同时清理已经落盘的文件，避免被拒绝的请求在 uploads 目录里留下孤儿文件。
 */
function receiveFiles(middleware) {
  return (req, res, next) => {
    middleware(req, res, (error) => {
      if (!error) return next();
      const files = [].concat(req.file || [], req.files || []);
      for (const file of files) removeQuietly(file && file.path);

      const errorMessages = {
        LIMIT_FILE_SIZE: '单张图片不能超过 5MB',
        LIMIT_UNEXPECTED_FILE: '一次最多上传 6 张图片',
        LIMIT_FILE_COUNT: '一次最多上传 6 张图片',
      };
      const msg = errorMessages[error.code] || error.message || '图片上传失败';
      res.status(400).json({ code: 400, msg });
    });
  };
}

/**
 * 校验已落盘的文件确实是图片。
 * 全部通过返回空串；只要有一个不是，就把本批文件全部删掉并返回提示。
 */
function verifyUploadedImages(files) {
  const list = (files || []).filter(Boolean);
  if (!list.length) return '';
  for (const file of list) {
    if (!isRealImage(file.path)) {
      for (const f of list) removeQuietly(f.path);
      return '文件内容不是有效的图片，请重新选择';
    }
  }
  return '';
}

/** 业务校验未通过时，把本次请求已落盘的图片删掉，避免留下无主文件 */
function cleanupUploads(req) {
  const files = [].concat(req.file || [], req.files || []);
  for (const file of files) removeQuietly(file && file.path);
}

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
  // 必须写 p.status：user 表在本查询里也有 status 列（1=正常 0=禁用），
  // 裸写 status 会让 MySQL 报 "Column 'status' in where clause is ambiguous"
  const where = ['p.status=1'];
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
    `SELECT p.*, c.name AS category_name, u.nickname AS seller_name, u.seller_mode AS seller_mode
     FROM product p LEFT JOIN category c ON p.category_id=c.id
     LEFT JOIN user u ON p.seller_id=u.id WHERE p.id=?`, [id]
  );
  if (!p) return res.status(404).json({ code: 404, msg: '商品不存在' });
  // 已被管理员下架的商品对前台一律不可见：即使拿到直链也不能打开详情。
  // 提示语与「不存在」保持同一口径，避免通过不同的报错反推出商品只是被下架。
  if (Number(p.status) !== 1) {
    return res.status(404).json({ code: 404, msg: '商品不存在或已下架' });
  }
  const images = await query('SELECT url FROM product_image WHERE product_id=?', [id]);
  p.images = images.map(i => i.url);
  // 登录用户记录浏览行为
  await recordInteraction(req.user.id, id, 'view', 1);
  res.json({ code: 0, data: p });
});

// 发布商品（需登录）
router.post('/publish', auth, receiveFiles(upload.single('cover')), async (req, res) => {
  const badImage = verifyUploadedImages([req.file]);
  if (badImage) return res.status(400).json({ code: 400, msg: badImage });

  const { title, description, price, stock, category_id } = req.body;
  if (!title || !price) {
    cleanupUploads(req);
    return res.status(400).json({ code: 400, msg: '标题和价格必填' });
  }
  const priceNum = Number(price);
  if (!Number.isFinite(priceNum) || priceNum < 0) {
    cleanupUploads(req);
    return res.status(400).json({ code: 400, msg: '价格需为不小于 0 的数字' });
  }
  const stockNum = Number(stock === undefined || stock === '' ? 1 : stock);
  if (!Number.isInteger(stockNum) || stockNum < 0) {
    cleanupUploads(req);
    return res.status(400).json({ code: 400, msg: '库存需为 0 或正整数' });
  }
  // 敏感词校验（服务端强制，前端绕过无效）
  const se = sensitiveError(title, '标题') || sensitiveError(description, '描述');
  if (se) {
    cleanupUploads(req);
    return res.status(400).json({ code: 400, msg: se });
  }
  // 前端先用 /product/image 上传拿到 url 列表，再随发布一起提交
  let imgs = [];
  try { imgs = req.body.images ? JSON.parse(req.body.images) : []; } catch (e) { imgs = []; }
  if (!Array.isArray(imgs)) imgs = [];
  const cover = req.file ? '/uploads/products/' + req.file.filename : (imgs[0] || '');
  // 分类必须真实存在，否则商品会变成"孤儿"（列表里永远显示未分类、按分类也筛不出来）
  const catId = Number(category_id) || 0;
  if (!catId) {
    cleanupUploads(req);
    return res.status(400).json({ code: 400, msg: '请选择商品分类' });
  }
  const [cat] = await query('SELECT id FROM category WHERE id=?', [catId]);
  if (!cat) {
    cleanupUploads(req);
    return res.status(400).json({ code: 400, msg: '所选分类不存在，请重新选择' });
  }
  const py = toPinyin(title);
  const r = await query(
    'INSERT INTO product(seller_id,category_id,title,description,price,stock,cover,title_pinyin,title_initials) VALUES(?,?,?,?,?,?,?,?,?)',
    [req.user.id, catId, title, description || '', priceNum, stockNum, cover, py.full, py.init]
  );
  for (const u of imgs) {
    if (u) await query('INSERT INTO product_image(product_id,url) VALUES(?,?)', [r.insertId, u]);
  }
  res.json({ code: 0, msg: '发布成功', data: { id: r.insertId } });
});

// 编辑商品（仅发布者）
router.put('/update/:id', auth, receiveFiles(upload.single('cover')), async (req, res) => {
  const badImage = verifyUploadedImages([req.file]);
  if (badImage) return res.status(400).json({ code: 400, msg: badImage });

  const { title, description, price, category_id, status } = req.body;
  const [own] = await query('SELECT id FROM product WHERE id=? AND seller_id=?', [req.params.id, req.user.id]);
  if (!own) {
    cleanupUploads(req);
    return res.status(403).json({ code: 403, msg: '无权限' });
  }
  const se = sensitiveError(title, '标题') || sensitiveError(description, '描述');
  if (se) {
    cleanupUploads(req);
    return res.status(400).json({ code: 400, msg: se });
  }
  // 状态只接受 0/1，避免前端传入任意数字把商品置成前台查不到的中间态
  const nextStatus = Number(status === undefined || status === null || status === '' ? 1 : status);
  if (nextStatus !== 0 && nextStatus !== 1) {
    cleanupUploads(req);
    return res.status(400).json({ code: 400, msg: '状态只能是 0（下架）或 1（在售）' });
  }
  const priceNum = Number(price);
  if (!Number.isFinite(priceNum) || priceNum < 0) {
    cleanupUploads(req);
    return res.status(400).json({ code: 400, msg: '价格需为不小于 0 的数字' });
  }
  // 库存允许为 0（表示暂时无货），但不接受负数与小数
  const stockNum = Number(req.body.stock === undefined || req.body.stock === '' ? 1 : req.body.stock);
  if (!Number.isInteger(stockNum) || stockNum < 0) {
    cleanupUploads(req);
    return res.status(400).json({ code: 400, msg: '库存需为 0 或正整数' });
  }
  const catId = Number(category_id) || 0;
  if (!catId) {
    cleanupUploads(req);
    return res.status(400).json({ code: 400, msg: '请选择商品分类' });
  }
  const [cat] = await query('SELECT id FROM category WHERE id=?', [catId]);
  if (!cat) {
    cleanupUploads(req);
    return res.status(400).json({ code: 400, msg: '所选分类不存在，请重新选择' });
  }

  const py = toPinyin(title);
  // 用字段名拼 SET 子句，不再靠数组下标插入封面参数（下标一旦错位就会把图片地址写进别的字段）
  const assignments = [
    'title=?', 'description=?', 'price=?', 'stock=?',
    'category_id=?', 'status=?', 'title_pinyin=?', 'title_initials=?',
  ];
  const params = [title, description || '', priceNum, stockNum, catId, nextStatus, py.full, py.init];
  if (req.file) {
    assignments.push('cover=?');
    params.push('/uploads/products/' + req.file.filename);
  }
  params.push(req.params.id);
  await query(`UPDATE product SET ${assignments.join(',')} WHERE id=?`, params);
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
router.post('/image', auth, receiveFiles(upload.array('images', 6)), async (req, res) => {
  const files = req.files || [];
  const badImage = verifyUploadedImages(files);
  if (badImage) return res.status(400).json({ code: 400, msg: badImage });

  const product_id = req.body.product_id;
  const urls = [];
  for (const f of files) {
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
