/* 临时自检：在 Node 里加载 demo/mock.js，验证公告接口的读写与权限 */
const fs = require('fs');
const path = require('path');

global.window = global;
const mem = {};
global.localStorage = {
  getItem: (k) => (k in mem ? mem[k] : null),
  setItem: (k, v) => { mem[k] = String(v); },
  removeItem: (k) => { delete mem[k]; }
};
global.btoa = (s) => Buffer.from(s, 'binary').toString('base64');
global.atob = (s) => Buffer.from(s, 'base64').toString('binary');

const mockPath = path.join(__dirname, 'mock.js');
// eslint-disable-next-line no-eval
eval(fs.readFileSync(mockPath, 'utf8'));

const U = (m, u, d) => global.__demoApi.request({ method: m, url: u, data: d }).then((r) => r.data);
const A = (m, u, d) => global.__demoAdminApi.request({ method: m, url: u, data: d }).then((r) => r.data);

const results = [];
const ok = (name, cond, extra) => results.push((cond ? 'PASS  ' : 'FAIL  ') + name + (extra ? '  -> ' + extra : ''));

(async () => {
  // 1) 未登录也能读公告（游客可见）
  let r = await U('get', '/notice/list');
  ok('游客可读公告列表', r.code === 0 && r.data.length === 3, 'code=' + r.code + ' len=' + (r.data || []).length);
  ok('公告按 id 倒序', r.data[0].id > r.data[1].id, r.data.map((n) => n.id).join(','));
  ok('公告含时间字段', !!r.data[0].created_at, r.data[0].created_at);

  // 2) 普通用户通道尝试发布 -> 必须失败
  r = await U('post', '/admin/notice', { title: '普通用户发的', content: 'x' });
  ok('普通用户通道不能发公告', r.code !== 0, 'code=' + r.code + ' msg=' + r.msg);

  // 3) 管理员通道发布成功
  r = await A('post', '/admin/notice', { title: '毕业设计答辩安排', content: '9 月 28 日上午 9 点在信息楼 305 答辩。' });
  ok('管理员可发布公告', r.code === 0, 'code=' + r.code);

  r = await U('get', '/notice/list');
  ok('发布后所有人可看到新公告', r.data.length === 4 && r.data[0].title === '毕业设计答辩安排', 'len=' + r.data.length + ' top=' + r.data[0].title);
  ok('新公告时间被记录', /\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(r.data[0].created_at), r.data[0].created_at);

  // 4) 空标题/空内容被拒
  r = await A('post', '/admin/notice', { title: '   ', content: '有内容' });
  ok('空标题被拒绝', r.code !== 0, 'msg=' + r.msg);
  r = await A('post', '/admin/notice', { title: '有标题', content: '  ' });
  ok('空内容被拒绝', r.code !== 0, 'msg=' + r.msg);

  console.log(results.join('\n'));
  const failed = results.filter((x) => x.startsWith('FAIL')).length;
  console.log('\n合计 ' + results.length + ' 项，失败 ' + failed + ' 项');
  process.exit(failed ? 1 : 0);
})();
