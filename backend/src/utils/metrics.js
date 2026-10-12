// 监控指标模块：基于 prom-client 暴露 Prometheus 可读的指标端点
// 提供：Node 进程默认指标 + 每个 HTTP 请求数 / 耗时 / 错误率
const client = require('prom-client');

const register = new client.Registry();
// 开启 Node 进程级默认指标（内存、事件循环延迟、GC 等），前缀 node_
client.collectDefaultMetrics({ register, prefix: 'node_' });

// 请求计数：按 方法 / 路由 / 状态码 区分
const httpRequestsTotal = new client.Counter({
  name: 'http_requests_total',
  help: '后端收到的 HTTP 请求总数',
  labelNames: ['method', 'route', 'status'],
  registers: [register],
});

// 请求耗时直方图：按 方法 / 路由，便于算 P95 等分位
const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP 请求处理耗时（秒）',
  labelNames: ['method', 'route'],
  buckets: [0.05, 0.1, 0.2, 0.5, 1, 2, 5],
  registers: [register],
});

// 把动态路径归一化，避免 /product/123 这种把标签基数打爆
function normalizeRoute(req) {
  return req.originalUrl.split('?')[0].replace(/\/\d+/g, '/:id');
}

// 请求中间件：跳过 /metrics 自身，避免自递归与噪声
function metricsMiddleware(req, res, next) {
  if (req.path === '/metrics') return next();
  const start = process.hrtime();
  const route = normalizeRoute(req);
  res.on('finish', () => {
    const diff = process.hrtime(start);
    const seconds = diff[0] + diff[1] / 1e9;
    httpRequestsTotal.inc({ method: req.method, route, status: res.statusCode });
    httpRequestDuration.observe({ method: req.method, route }, seconds);
  });
  next();
}

module.exports = { register, metricsMiddleware };
