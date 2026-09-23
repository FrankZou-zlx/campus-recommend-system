/**
 * 验证演示版 mock 层对两种传参都兼容：
 *   A) 新写法（与真实 axios 一致）：request({ method, url, params })
 *   B) 旧写法：request({ method, url, data: { params } })
 */
const fs = require('fs');
const path = require('path');

const dir = __dirname;

global.window = global;
const mem = {};
global.localStorage = {
  getItem: (k) => (k in mem ? mem[k] : null),
  setItem: (k, v) => { mem[k] = String(v); },
  removeItem: (k) => { delete mem[k]; }
};
global.btoa = (s) => Buffer.from(s, 'binary').toString('base64');
global.atob = (s) => Buffer.from(s, 'base64').toString('binary');
eval(fs.readFileSync(path.join(dir, 'mock.js'), 'utf8'));

let pass = 0, fail = 0;
const ok = (n, c, extra) => { c ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + '   → ' + extra)); };

(async () => {
  const api = global.__demoApi;
  const call = (cfg) => api.request(cfg).then((r) => r.data);

  const cats = await call({ method: 'get', url: '/category/list' });
  const cat = cats.data[0];
  console.log('  演示版第一个分类: id=' + cat.id + '  ' + cat.name);

  const noFilter = await call({ method: 'get', url: '/product/list', params: { page: 1, size: 99 } });
  console.log('  不筛选 total=' + noFilter.data.total);

  // A) 新写法
  const a = await call({ method: 'get', url: '/product/list', params: { page: 1, size: 99, category_id: cat.id, keyword: '' } });
  ok('新写法(params 单独传) 能按分类过滤',
    a.data.total > 0 && a.data.total < noFilter.data.total
      && a.data.list.every((p) => p.category_id === cat.id || p.category_name === cat.name),
    'total=' + a.data.total + ' / 全量=' + noFilter.data.total);

  // B) 旧写法
  const b = await call({ method: 'get', url: '/product/list', data: { params: { page: 1, size: 99, category_id: cat.id, keyword: '' } } });
  ok('旧写法(params 塞在 data 里) 仍然可用', b.data.total === a.data.total,
    'old=' + b.data.total + ' new=' + a.data.total);

  // C) 搜索
  const s1 = await call({ method: 'get', url: '/product/list', params: { page: 1, size: 99, category_id: '', keyword: '考研 英语' } });
  const s2 = await call({ method: 'get', url: '/product/list', data: { params: { page: 1, size: 99, category_id: '', keyword: '考研 英语' } } });
  ok('搜索「考研 英语」两种写法结果一致', s1.data.total === s2.data.total && s1.data.total > 0,
    'new=' + s1.data.total + ' old=' + s2.data.total);
  console.log('     → ' + (s1.data.list || []).map((p) => p.title).join('、'));

  // D) POST body 不受影响
  const login = await call({ method: 'post', url: '/auth/login', data: { username: 'user001', password: '123456' } });
  ok('POST body 正常（登录成功）', login.code === 0, JSON.stringify(login).slice(0, 120));

  console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})();
