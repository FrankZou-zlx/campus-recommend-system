/**
 * 监控指标模块
 * ---------------------------------------------------------------------------
 * 基于 prom-client 暴露 Prometheus 可读的指标端点，包含两类数据：
 *   1. Node 进程默认指标（内存、事件循环延迟、GC 等），统一加 node_ 前缀
 *   2. 每个 HTTP 请求的计数、耗时直方图、错误率
 * 端点由 app.js 挂在 /metrics，Prometheus 定时拉取。
 */
const client = require('prom-client');

const register = new client.Registry();
client.collectDefaultMetrics({ register, prefix: 'node_' });

// 请求计数：按 方法 / 路由 / 状态码 区分，用于算 QPS 与错误率
const httpRequestsTotal = new client.Counter({
  name: 'http_requests_total',
  help: '后端收到的 HTTP 请求总数',
  labelNames: ['method', 'route', 'status'],
  registers: [register],
});

// 请求耗时直方图：按 方法 / 路由 区分，配合 PromQL 算 P95 等分位
const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP 请求处理耗时（秒）',
  labelNames: ['method', 'route'],
  buckets: [0.05, 0.1, 0.2, 0.5, 1, 2, 5],
  registers: [register],
});

/**
 * 把动态路径归一化成模板路径。
 * 例如 /api/product/123 → /api/product/:id，
 * 否则每件商品都会生成一条独立时间序列，标签基数会被打爆。
 */
function normalizeRoute(req) {
  const pathWithoutQuery = req.originalUrl.split('?')[0];
  return pathWithoutQuery.replace(/\/\d+/g, '/:id');
}

/**
 * 请求埋点中间件：在响应结束时记录计数与耗时。
 * 必须挂在所有路由之前，否则统计不到匹配失败的请求。
 * /metrics 自身要跳过，避免自递归与噪声。
 */
function metricsMiddleware(req, res, next) {
  if (req.path === '/metrics') {
    return next();
  }

  const startTime = process.hrtime();
  const route = normalizeRoute(req);

  res.on('finish', () => {
    const elapsed = process.hrtime(startTime);
    const elapsedSeconds = elapsed[0] + elapsed[1] / 1e9;

    httpRequestsTotal.inc({
      method: req.method,
      route,
      status: res.statusCode,
    });
    httpRequestDuration.observe({ method: req.method, route }, elapsedSeconds);
  });

  next();
}

module.exports = { register, metricsMiddleware };
