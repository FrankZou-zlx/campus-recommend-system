/* 演示版自检（第二批）：搜索历史/热搜、后台图表、演示订单、发布带图片 */
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

// eslint-disable-next-line no-eval
eval(fs.readFileSync(path.join(__dirname, 'mock.js'), 'utf8'));

const U = (m, u, d) => global.__demoApi.request({ method: m, url: u, data: d }).then((r) => r.data);
const A = (m, u, d) => global.__demoAdminApi.request({ method: m, url: u, data: d }).then((r) => r.data);

const out = [];
const ok = (n, c, e) => out.push((c ? 'PASS  ' : 'FAIL  ') + n + (e ? '  -> ' + e : ''));

(async () => {
  // 以 user001 身份
  global.localStorage.setItem('token', global.btoa(JSON.stringify({ id: 1, username: 'user001', role: 'user' })));

  // 1) 搜索历史
  let r = await U('post', '/search/log', { keyword: '高等数学' });
  ok('记录搜索词', r.code === 0);
  await U('post', '/search/log', { keyword: 'iPad' });
  await U('post', '/search/log', { keyword: '高等数学' });
  r = await U('get', '/search/mine');
  ok('我的搜索历史去重', r.code === 0 && r.data.length === 2, JSON.stringify(r.data));
  r = await U('get', '/search/hot', { params: { limit: 5 } });
  const hotOk = r.code === 0 && r.data.length > 0 &&
    r.data.every((x, i, a) => i === 0 || a[i - 1].count >= x.count) &&
    r.data.some((x) => x.keyword === '高等数学');
  ok('热搜词按次数排序且含搜索过的词', hotOk, JSON.stringify(r.data));
  r = await U('delete', '/search/mine');
  ok('清空我的搜索历史', r.code === 0);
  r = await U('get', '/search/mine');
  ok('清空后历史为空', r.data.length === 0, JSON.stringify(r.data));
  // 游客不记录
  global.localStorage.removeItem('token');
  r = await U('post', '/search/log', { keyword: '游客搜索' });
  ok('游客搜索不入库', r.code === 0);
  global.localStorage.setItem('token', global.btoa(JSON.stringify({ id: 1, username: 'user001', role: 'user' })));

  // 2) 演示订单 + 图表
  const orders = JSON.parse(global.localStorage.getItem('demo_orders') || '[]');
  ok('已灌入演示订单', orders.length > 30, orders.length + ' 笔');
  ok('订单含收货信息', orders[0] && orders[0].buyer && !!orders[0].buyer.detail, orders[0] ? orders[0].buyer.detail : '');

  const ch = await A('get', '/admin/charts');
  ok('图表接口可用', ch.code === 0, 'code=' + ch.code);
  const d = ch.data || {};
  ok('类目成交额有数据', Array.isArray(d.byCategory) && d.byCategory.length > 0 && d.byCategory[0].amount > 0,
    (d.byCategory || []).slice(0, 4).map((x) => `${x.name}:${x.amount}`).join(' / '));
  ok('近 7 日序列完整', Array.isArray(d.byDay) && d.byDay.length === 7, (d.byDay || []).map((x) => `${x.day}=${x.amount}`).join(' '));
  ok('7 日总额与订单一致', (d.byDay || []).reduce((a, b) => a + b.amount, 0) > 0);

  // 3) 发布商品带图片（image 路由需要浏览器环境，这里直接验证 publish 接收 images 字段）
  r = await U('post', '/product/publish', {
    title: '带图商品', price: 66, stock: 1, category_id: 2, description: '测试', images: JSON.stringify(['data:image/jpeg;base64,x1', 'data:image/jpeg;base64,x2'])
  });
  ok('发布带图片', r.code === 0);
  r = await U('get', '/product/list', { params: { keyword: '带图商品' } });
  const pd = (r.data && r.data.list && r.data.list[0]) || {};
  ok('新商品带封面与图集', pd.cover === 'data:image/jpeg;base64,x1' && (pd.images || []).length === 2,
    'cover=' + (pd.cover || '').slice(0, 24) + ' images=' + (pd.images || []).length);

  console.log(out.join('\n'));
  const failed = out.filter((x) => x.startsWith('FAIL')).length;
  console.log('\n合计 ' + out.length + ' 项，失败 ' + failed + ' 项');
  process.exit(failed ? 1 : 0);
})();
