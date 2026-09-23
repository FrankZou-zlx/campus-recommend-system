/* 演示版自检：账号空格处理 + 协同过滤数据接口 + 推荐结果合理性 */
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
  // 账号空格
  let r = await U('post', '/auth/login', { username: ' user 001 ', password: '123456' });
  ok('账号带空格可正常登录（被规整）', r.code === 0, 'code=' + r.code);
  r = await U('post', '/auth/login', { username: '     ', password: '123456' });
  ok('纯空格账号被拦截', r.code !== 0, r.msg);
  r = await A('post', '/auth/admin/login', { username: ' a d m i n ', password: 'admin123' });
  ok('管理员账号带空格可登录（被规整）', r.code === 0, 'code=' + r.code);
  r = await A('post', '/auth/admin/login', { username: ' ', password: 'admin123' });
  ok('管理员纯空格账号被拦截', r.code !== 0, r.msg);

  // 协同过滤数据
  const ins = await A('get', '/admin/cf-insight');
  ok('算法数据接口可用', ins.code === 0, 'code=' + ins.code);
  const d = ins.data;
  ok('行为矩阵规模合理', d.interactions > 500 && d.users > 50 && d.items > 30,
    `行为${d.interactions}条 / 用户${d.users}人 / 商品${d.items}件 / 商品对${d.pairs}组`);
  ok('相似商品对已算出', Array.isArray(d.topPairs) && d.topPairs.length > 0 && d.topPairs[0].sim > 0,
    d.topPairs[0] ? `${d.topPairs[0].a} × ${d.topPairs[0].b} = ${d.topPairs[0].sim}（共同用户 ${d.topPairs[0].coUsers}）` : 'empty');
  ok('样例推荐带依据', d.sample.reco.length > 0 && d.sample.reco[0].reasons.length > 0,
    d.sample.reco[0] ? `${d.sample.reco[0].title} 推荐分 ${d.sample.reco[0].score}` : 'empty');

  console.log(out.join('\n'));
  console.log('\n===== 演示版协同过滤数据 =====');
  console.log(`行为 ${d.interactions} 条 | 参与用户 ${d.users} 人 | 参与商品 ${d.items} 件 | 可比商品对 ${d.pairs} 组`);
  console.log('相似度最高的 5 组商品对：');
  d.topPairs.slice(0, 5).forEach((p) => console.log(`  ${p.a}  ×  ${p.b}   相似度 ${p.sim}   共同交互用户 ${p.coUsers} 人`));
  console.log(`样例用户：${d.sample.nickname}（id=${d.sample.userId}）历史行为 ${d.sample.history.length} 条`);
  console.log('  历史：' + d.sample.history.map((h) => `${h.title}[${h.type}]`).join('、'));
  console.log('  推荐：');
  d.sample.reco.forEach((x, i) => console.log(`   ${i + 1}. ${x.title}  推荐分=${x.score}  依据：${x.reasons.map((y) => `${y.title}(${y.sim})`).join(' + ')}`));

  // 推荐位本身是否正常（user001 偏好图书+数码）
  const reco = await U('get', '/recommend/for-you', { params: { limit: 8 }, headers: { Authorization: 'x' } });
  global.localStorage.setItem('token', global.btoa(JSON.stringify({ id: 1, username: 'user001', role: 'user' })));
  const reco2 = await U('get', '/recommend/for-you', { params: { limit: 8 } });
  ok('user001 仍能拿到推荐', reco2.code === 0 && reco2.data.length > 0, (reco2.data || []).map((p) => p.title).join('、'));

  const failed = out.filter((x) => x.startsWith('FAIL')).length;
  console.log('\n合计 ' + out.length + ' 项，失败 ' + failed + ' 项');
  process.exit(failed ? 1 : 0);
})();
