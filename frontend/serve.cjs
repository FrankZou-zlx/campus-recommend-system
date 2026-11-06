/**
 * 零依赖静态服务器 + API 反向代理（本地开发用）
 * ---------------------------------------------------------------------------
 * 前端是免构建方案：Vue3 / Element Plus / Axios 已经放在 vendor/ 下，
 * 因此不需要 npm install，也不需要 Vite。这个脚本只做两件事：
 *   1. 把 frontend/ 目录按静态文件提供出去（默认 8080 端口）；
 *   2. 把 /api 和 /uploads 原样转发给后端（默认 127.0.0.1:3001）。
 * 同源之后前端可以直接用相对路径 /api/... 请求，省掉 CORS 配置。
 *
 * 用法：
 *   node serve.cjs
 *   PORT=8081 API_TARGET=http://127.0.0.1:3001 node serve.cjs
 *
 * 说明：Linux 生产环境不用这个脚本，静态资源由 Nginx 直接托管，
 * 反代也在 Nginx 层完成（见 deploy/nginx/campus-mall.conf）。
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 8080);
const API_TARGET = process.env.API_TARGET || 'http://127.0.0.1:3001';
const API_ORIGIN = new URL(API_TARGET);
const PROXY_PREFIXES = ['/api', '/uploads'];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.cjs': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
};

/** 拼出磁盘路径，并挡住 ../ 穿越到 frontend/ 之外的请求 */
function resolveFile(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath.split('?')[0]);
  } catch (_) {
    return null;
  }
  const rel = decoded.replace(/^\/+/, '');
  const full = path.resolve(ROOT, rel);
  if (full !== ROOT && !full.startsWith(ROOT + path.sep)) return null;
  return full;
}

function serveStatic(req, res, urlPath) {
  let file = resolveFile(urlPath);
  if (!file) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('路径不合法');
  }

  // 前端用 hash 路由（#/xxx），浏览器不会把 # 后面的部分发给服务器；
  // 这里仍对无扩展名路径回退到 index.html，方便以后改成 history 模式。
  const looksLikeFile = path.extname(file) !== '';
  if (!looksLikeFile) file = path.join(ROOT, 'index.html');

  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('404 Not Found: ' + urlPath);
    }
    const ext = path.extname(file).toLowerCase();
    const headers = {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': stat.size,
      // 本地开发时改动要立刻生效，入口 HTML 尤其不能让浏览器缓存住
      'Cache-Control': ext === '.html' ? 'no-store' : 'no-cache',
    };
    res.writeHead(200, headers);
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

/**
 * 反向代理：把请求体原样 pipe 给后端。
 * multipart 上传靠 pipe 透传二进制流，不能先用 JSON 解析读一遍。
 */
function proxy(req, res, urlPath) {
  const headers = Object.assign({}, req.headers, {
    host: API_ORIGIN.host,
  });
  // 转发的是本机地址，去掉代理相关的头，避免后端拿到错误的来源
  delete headers['proxy-authorization'];

  const upstream = http.request(
    {
      hostname: API_ORIGIN.hostname,
      port: API_ORIGIN.port || 80,
      method: req.method,
      path: urlPath,
      headers,
      timeout: 30000,
    },
    (up) => {
      res.writeHead(up.statusCode || 502, up.headers);
      up.pipe(res);
    }
  );

  upstream.on('timeout', () => upstream.destroy(new Error('后端响应超时')));
  upstream.on('error', (error) => {
    console.error('[serve] 转发失败:', error.message);
    if (res.headersSent) return res.end();
    res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ code: 502, msg: '后端服务未启动或不可达：' + API_TARGET }));
  });

  req.pipe(upstream);
}

const server = http.createServer((req, res) => {
  const urlPath = (req.url || '/').split('#')[0];
  if (PROXY_PREFIXES.some((p) => urlPath === p || urlPath.startsWith(p + '/'))) {
    return proxy(req, res, urlPath);
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('405 Method Not Allowed');
  }
  serveStatic(req, res, urlPath === '/' ? '/index.html' : urlPath);
});

server.on('clientError', (_err, socket) => {
  if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`[serve] 端口 ${PORT} 已被占用。换个端口：PORT=8081 node serve.cjs`);
  } else {
    console.error('[serve] 启动失败:', error.message);
  }
  process.exit(1);
});

server.listen(PORT, () => {
  console.log(`[serve] 前端已启动: http://localhost:${PORT}`);
  console.log(`[serve] /api 与 /uploads 转发到 ${API_TARGET}`);
});
