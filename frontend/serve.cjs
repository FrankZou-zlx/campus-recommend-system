/* 零依赖静态服务器：托管前端，并把 /api 与 /uploads 代理到后端(3001) */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const FRONTEND = __dirname;
const API_HOST = '127.0.0.1';
const API_PORT = 3001;
const PORT = 8080;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon'
};

function proxy(req, res, u) {
  const options = {
    host: API_HOST, port: API_PORT, method: req.method,
    path: u.pathname + u.search,
    headers: { ...req.headers, host: API_HOST + ':' + API_PORT }
  };
  const p = http.request(options, (pr) => {
    res.writeHead(pr.statusCode, pr.headers);
    pr.pipe(res);
  });
  p.on('error', (e) => { res.writeHead(502, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ code: -1, msg: '代理失败: ' + e.message })); });
  req.pipe(p);
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname.startsWith('/api') || u.pathname.startsWith('/uploads')) {
    return proxy(req, res, u);
  }
  let filePath = path.join(FRONTEND, u.pathname === '/' ? 'index.html' : u.pathname);
  fs.readFile(filePath, (err, data) => {
    if (err) {
      // SPA 兜底：未命中文件时返回 index.html
      fs.readFile(path.join(FRONTEND, 'index.html'), (e2, html) => {
        if (e2) { res.writeHead(404); res.end('not found'); return; }
        res.writeHead(200, { 'Content-Type': MIME['.html'] }); res.end(html);
      });
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log('[campus-mall] 前端已启动: http://localhost:' + PORT);
});
