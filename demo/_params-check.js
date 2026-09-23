/**
 * 验证 U()/A() 的请求层是否把 params 正确交给 axios。
 * 做法：从真实文件里抽出 call() 源码，用假的 axios 实例记录收到的 config。
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

function extractCall(file) {
  const s = fs.readFileSync(file, 'utf8');
  const start = s.indexOf('async function call(ins, method, url, data) {');
  if (start < 0) throw new Error('找不到 call 函数: ' + file);
  let i = s.indexOf('{', start), depth = 0, end = -1;
  for (; i < s.length; i++) {
    if (s[i] === '{') depth++;
    else if (s[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  return s.slice(start, end);
}

function buildCall(file) {
  const src = extractCall(file);
  const made = [];
  const fakeUser = {
    request(cfg) { made.push({ ins: 'user', cfg }); return Promise.resolve({ data: { code: 0, data: { ok: 1 } } }); }
  };
  const fakeAdmin = {
    request(cfg) { made.push({ ins: 'admin', cfg }); return Promise.resolve({ data: { code: 0, data: { ok: 1 } } }); }
  };
  const store = { token: '', adminToken: '' };
  const ElMessage = { warning() {}, error() {} };
  const factory = new Function('userApi', 'adminApi', 'store', 'ElMessage', src + '\n return call;');
  return { call: factory(fakeUser, fakeAdmin, store, ElMessage), made, fakeUser, fakeAdmin };
}

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '   → ' + extra : '')); }
}

for (const rel of ['frontend/app.js', 'demo/app.js']) {
  const file = path.join(root, rel);
  console.log('\n===== ' + rel + ' =====');
  const { call, made, fakeUser, fakeAdmin } = buildCall(file);

  // 1) 真实场景：分类筛选
  made.length = 0;
  call(fakeUser, 'get', '/product/list', { params: { page: 1, size: 12, category_id: 7, keyword: '' } });
  let c = made[0] && made[0].cfg;
  ok('GET 查询参数进入 config.params',
    !!c && !!c.params && String(c.params.category_id) === '7',
    JSON.stringify(c));
  ok('GET 不会把 {params} 当成请求体', !!c && c.data === undefined, JSON.stringify(c && c.data));

  // 2) 搜索
  made.length = 0;
  call(fakeUser, 'get', '/product/list', { params: { page: 1, size: 12, category_id: '', keyword: '考研 英语' } });
  c = made[0] && made[0].cfg;
  ok('搜索关键词进入 params', !!c && !!c.params && c.params.keyword === '考研 英语', JSON.stringify(c));

  // 3) 普通 POST body 不受影响
  made.length = 0;
  call(fakeUser, 'post', '/cart/add', { product_id: 3, quantity: 1 });
  c = made[0] && made[0].cfg;
  ok('POST body 原样作为 data',
    !!c && !!c.data && c.data.product_id === 3 && c.params === undefined,
    JSON.stringify(c && { data: c.data, params: c.params }));

  // 4) 无第三个参数（如 DELETE /profile）
  made.length = 0;
  call(fakeUser, 'delete', '/user/address/5');
  c = made[0] && made[0].cfg;
  ok('无参数时 data/params 均为空', !!c && c.data === undefined && c.params === undefined, JSON.stringify(c));

  // 5) 管理员通道
  made.length = 0;
  call(fakeAdmin, 'get', '/search/hot', { params: { limit: 8 } });
  c = made[0] && made[0].cfg;
  ok('管理员通道同样带上 params', !!c && !!c.params && c.params.limit === 8, JSON.stringify(c));
}

console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
