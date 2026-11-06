/**
 * 应用入口：装配中间件、挂载路由、兜底错误处理、启动服务
 * ---------------------------------------------------------------------------
 * 挂载顺序有讲究，改动前先确认依赖：
 *   CORS → JSON 解析 → 静态图片目录 → 监控埋点 → 业务路由 → 404 → 错误处理
 * 监控埋点必须在路由之前，否则统计不到请求；404 与错误处理必须最后，
 * 否则前面的中间件出错时没有兜底，一条 SQL 写错就会让整个服务退出。
 */
const express = require('express');
// Express 4 不会捕获 async 处理器里抛出的异常：一旦某条 SQL 报错，
// 请求既不会返回 500 也不会断开，客户端只能一直等到超时（表现为「页面一直转圈」）。
// 这一行把 async 路由的 rejection 转交给下面的错误中间件。
require('express-async-errors');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const { register, metricsMiddleware } = require('./utils/metrics');

const app = express();

// 允许的前端来源，多个用逗号分隔；默认只放行本地开发端口
const allowedOrigins = (process.env.CLIENT_ORIGIN || 'http://localhost:5173').split(',');
app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(express.json());

// 商品图片静态目录
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

// 监控埋点：统计每个请求的数量、耗时与错误率
app.use(metricsMiddleware);

// ---- 业务路由：一个一级模块一个文件 ----
app.use('/api/auth', require('./routes/auth'));
app.use('/api/user', require('./routes/user'));
app.use('/api/category', require('./routes/category'));
app.use('/api/notice', require('./routes/notice')); // 公告：公开可读，发布在 /api/admin/notice
app.use('/api/search', require('./routes/search')); // 搜索历史与热搜词
app.use('/api/product', require('./routes/product'));
app.use('/api/cart', require('./routes/cart'));
app.use('/api/order', require('./routes/order'));
app.use('/api/message', require('./routes/message'));
app.use('/api/recommend', require('./routes/recommend'));
app.use('/api/admin', require('./routes/admin'));

// 健康检查：部署脚本与探活用
app.get('/api/health', (req, res) => res.json({ code: 0, msg: 'ok' }));

/**
 * /metrics 只允许内网访问
 * ---------------------------------------------------------------------------
 * 指标里含接口路径、QPS、内存等信息，不该对公网敞开。生产环境由 Nginx
 * 只反代 /api 和 /uploads，本来就不会转发 /metrics；这里再挡一层，
 * 防止后端端口被直接暴露时泄露。Prometheus 与 Grafana 都从 127.0.0.1 拉取。
 */
function isInternalAddress(raw) {
  const ip = String(raw || '').replace(/^::ffff:/, '');
  if (ip === '::1' || ip === '127.0.0.1' || ip.startsWith('127.')) return true;
  if (ip.startsWith('10.') || ip.startsWith('192.168.') || ip.startsWith('169.254.')) return true;
  const m = /^172\.(\d{1,3})\./.exec(ip);
  if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return true;
  const extra = (process.env.METRICS_ALLOW || '').split(',').map((s) => s.trim()).filter(Boolean);
  return extra.includes(ip);
}

app.get('/metrics', (req, res, next) => {
  if (!isInternalAddress(req.socket.remoteAddress)) {
    return res.status(403).json({ code: 403, msg: '指标接口仅允许内网访问' });
  }
  next();
}, async (req, res) => {
  res.set('Content-Type', register.contentType);
  const metricsText = await register.metrics();
  res.end(metricsText);
});

// 兜底一：没有任何路由匹配
app.use((req, res) => {
  res.status(404).json({
    code: 404,
    msg: '接口不存在: ' + req.method + ' ' + req.originalUrl,
  });
});

// 兜底二：路由内部抛出的异常。
// 业务错误（主动标记 isBusiness，例如「库存不足」）可以把 message 直接给用户；
// SQL 报错、依赖异常只写服务端日志，对外统一提示，避免泄露表结构与 SQL 片段。
// 响应头已发出时交回 Express 默认处理，避免二次写入。
app.use((err, req, res, next) => {
  console.error('[campus-mall] 请求处理失败:', (err && err.message) || err);
  if (res.headersSent) {
    return next(err);
  }
  if (err && err.isBusiness) {
    return res.status(400).json({ code: 400, msg: err.message });
  }
  res.status(500).json({ code: 500, msg: '服务器繁忙，请稍后重试' });
});

// 进程级兜底：异步异常与未捕获异常只记录日志，不让进程直接退出
process.on('unhandledRejection', (error) => {
  console.error('[campus-mall] 未处理的异步异常:', (error && error.message) || error);
});
process.on('uncaughtException', (error) => {
  console.error('[campus-mall] 未捕获异常:', (error && error.message) || error);
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`[campus-mall] API 已启动: http://localhost:${PORT}`);
});

module.exports = app;
