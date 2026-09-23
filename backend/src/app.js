const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();

const allowed = (process.env.CLIENT_ORIGIN || 'http://localhost:5173').split(',');
app.use(cors({ origin: allowed, credentials: true }));
app.use(express.json());
// 商品图片静态目录
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

// 路由
app.use('/api/auth', require('./routes/auth'));
app.use('/api/user', require('./routes/user'));
app.use('/api/category', require('./routes/category'));
app.use('/api/notice', require('./routes/notice'));   // 公告：公开可读，发布在 /api/admin/notice
app.use('/api/search', require('./routes/search'));   // 搜索历史与热搜词
app.use('/api/product', require('./routes/product'));
app.use('/api/cart', require('./routes/cart'));
app.use('/api/order', require('./routes/order'));
app.use('/api/message', require('./routes/message'));
app.use('/api/recommend', require('./routes/recommend'));
app.use('/api/admin', require('./routes/admin'));

app.get('/api/health', (req, res) => res.json({ code: 0, msg: 'ok' }));

// 兜底：任何路由抛错都不要把整个服务带崩（之前一条 SQL 写错就整台服务退出）
app.use((req, res) => res.status(404).json({ code: 404, msg: '接口不存在: ' + req.method + ' ' + req.originalUrl }));
app.use((err, req, res, next) => {
  console.error('[campus-mall] 请求处理失败:', err && err.message);
  if (res.headersSent) return next(err);
  res.status(500).json({ code: 500, msg: '服务器错误: ' + ((err && err.message) || '未知错误') });
});
process.on('unhandledRejection', (e) => console.error('[campus-mall] 未处理的异步异常:', (e && e.message) || e));
process.on('uncaughtException', (e) => console.error('[campus-mall] 未捕获异常:', (e && e.message) || e));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`[campus-mall] API 已启动: http://localhost:${PORT}`);
});

module.exports = app;
