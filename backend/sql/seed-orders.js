/**
 * 历史订单种子脚本（毕设演示用）
 *
 * 为什么需要它：seed.js 只生成「用户 / 商品 / 浏览行为」，不产生订单。
 * 结果就是管理端「成交额 ¥0.00、类目柱状图空、近 7 日折线图全 0」，
 * 卖家「我卖出的」也是空的 —— 答辩时看着像没做完。
 *
 * 本脚本按真实交易形态补一批历史订单：
 *   - 买家 ≠ 卖家（不会自己买自己的东西）
 *   - 每单 1~2 件商品，金额 = 各明细小计之和
 *   - 下单时间散布在近 14 天，且越近越多（折线图有起伏）
 *   - 状态分布贴近真实：已完成居多、少量已付款、少量待付款
 *   - 给买家补收货地址，这样「我卖出的」能显示买家收货信息
 *
 * 运行：
 *   node sql/seed-orders.js                 已有订单则跳过（幂等，可反复执行）
 *   FORCE=1 node sql/seed-orders.js         清空订单后重灌
 *   COUNT=80 node sql/seed-orders.js        指定生成笔数（默认 48）
 *
 * 也会被 seed.js 在末段调用（重灌演示数据时自动带上订单）。
 */
require('dotenv').config();
const { query } = require('../src/db');

// ---------- 可复现的伪随机数（与 seed.js 同款线性同余） ----------
let _seed = 20260923;
function rnd() { _seed = (_seed * 1103515245 + 12345) & 0x7fffffff; return _seed / 0x7fffffff; }
function randInt(a, b) { return a + Math.floor(rnd() * (b - a + 1)); }
function pick(arr) { return arr[Math.floor(rnd() * arr.length)]; }

const BUILDINGS = ['学生公寓1栋', '学生公寓3栋', '学生公寓5栋', '研究生公寓2栋', '学生公寓7栋', '国际交流中心'];
const SURNAMES = ['王', '李', '张', '刘', '陈', '杨', '赵', '黄', '周', '吴', '徐', '孙', '马', '朱', '胡', '郭', '何', '高', '林', '罗'];
const GIVEN = ['小明', '雨欣', '浩然', '子涵', '思远', '佳怡', '宇航', '梦琪', '志强', '欣怡', '泽宇', '静怡'];

function pad2(n) { return String(n).padStart(2, '0'); }
function fmtDateTime(d) {
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' +
    pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
}

/**
 * @param {{force?:boolean, count?:number, silent?:boolean}} opts
 * @returns {Promise<{orders:number, items:number, amount:number, skipped?:boolean}>}
 */
async function seedOrders(opts) {
  const o = Object.assign({ force: false, count: 48, silent: false }, opts || {});
  const log = o.silent ? function () {} : function () { console.log.apply(console, arguments); };

  // ---------- 幂等：已有订单就跳过 ----------
  const existRow = await query('SELECT COUNT(*) c FROM `order`');
  const existing = Number(existRow[0].c);
  if (existing > 0 && !o.force) {
    log(`   已有 ${existing} 笔订单，跳过（重灌请用 FORCE=1 node sql/seed-orders.js）`);
    const amtRow = await query('SELECT COALESCE(SUM(total),0) s FROM `order` WHERE status>=1');
    return { orders: existing, items: 0, amount: Number(amtRow[0].s), skipped: true };
  }
  if (o.force && existing > 0) {
    log(`   清空已有 ${existing} 笔订单…`);
    await query('DELETE FROM order_item');
    await query('DELETE FROM `order`');
  }

  // ---------- 取数据源 ----------
  const products = await query(
    'SELECT id, seller_id, title, price, category_id FROM product WHERE status=1 ORDER BY id'
  );
  if (!products.length) throw new Error('没有在售商品，请先执行 node sql/seed.js');

  const users = await query('SELECT id, nickname FROM user ORDER BY id');
  if (users.length < 2) throw new Error('用户不足，无法生成订单');

  // ---------- 买家收货地址：没有就补一条 ----------
  const addrRows = await query('SELECT id, user_id FROM address');
  const addrMap = new Map();
  addrRows.forEach(function (r) { if (!addrMap.has(r.user_id)) addrMap.set(r.user_id, r.id); });

  async function ensureAddress(uid) {
    if (addrMap.has(uid)) return addrMap.get(uid);
    const name = pick(SURNAMES) + pick(GIVEN);
    const phone = '13' + String(randInt(100000000, 999999999));
    const detail = '阳光大学 ' + pick(BUILDINGS) + ' ' + randInt(101, 618) + ' 室（菜鸟驿站代收）';
    const r = await query(
      'INSERT INTO address(user_id,name,phone,detail,is_default) VALUES(?,?,?,?,1)',
      [uid, name, phone, detail]
    );
    addrMap.set(uid, r.insertId);
    return r.insertId;
  }

  // ---------- 生成订单 ----------
  const now = Date.now();
  let insertedOrders = 0, insertedItems = 0, totalAmount = 0;
  const seq = { n: 0 };

  for (let i = 0; i < o.count; i++) {
    // 下单时间：近 14 天内，指数偏置让"最近几天"更密集（折线图会好看）
    const daysAgo = Math.floor(Math.pow(rnd(), 1.7) * 14);
    const t = new Date(now - daysAgo * 86400000);
    t.setHours(randInt(8, 22), randInt(0, 59), randInt(0, 59), 0);

    // 选买家：随机一个用户
    const buyer = pick(users);

    // 选商品：1~2 件，且卖家不能是自己
    const nItems = rnd() < 0.62 ? 1 : 2;
    const chosen = [];
    let guard = 0;
    while (chosen.length < nItems && guard++ < 40) {
      const p = pick(products);
      if (Number(p.seller_id) === Number(buyer.id)) continue;         // 不能买自己的
      if (chosen.some(function (x) { return x.id === p.id; })) continue; // 不重复
      chosen.push(p);
    }
    if (!chosen.length) continue;

    // 状态分布贴近真实交易形态：已完成 50% / 已发货 22% / 已付款 20% / 待付款 8%
    // 对应新语义：0=待付款 1=已付款 2=已发货·待收货 3=已完成 4=已取消
    const r = rnd();
    const status = r < 0.50 ? 3 : (r < 0.72 ? 2 : (r < 0.92 ? 1 : 0));

    const addressId = await ensureAddress(buyer.id);

    let total = 0;
    chosen.forEach(function (p) {
      const qty = rnd() < 0.85 ? 1 : 2;
      p._qty = qty;
      total += Number(p.price) * qty;
    });
    total = Math.round(total * 100) / 100;

    seq.n += 1;
    const orderNo = 'SO' + fmtDateTime(t).replace(/[-: ]/g, '') + String(1000 + seq.n);
    const res = await query(
      'INSERT INTO `order`(order_no,user_id,total,status,address_id,created_at) VALUES(?,?,?,?,?,?)',
      [orderNo, buyer.id, total, status, addressId, fmtDateTime(t)]
    );
    const orderId = res.insertId;
    insertedOrders += 1;

    for (const p of chosen) {
      await query(
        'INSERT INTO order_item(order_id,product_id,title,price,quantity) VALUES(?,?,?,?,?)',
        [orderId, p.id, p.title, p.price, p._qty]
      );
      insertedItems += 1;
    }
    if (status >= 1) totalAmount += total;   // 只有付款后的才计入成交额（与后台口径一致）
  }

  totalAmount = Math.round(totalAmount * 100) / 100;
  log(`   已生成历史订单 ${insertedOrders} 笔 / 明细 ${insertedItems} 条 / 成交额 ¥${totalAmount.toFixed(2)}`);
  return { orders: insertedOrders, items: insertedItems, amount: totalAmount };
}

module.exports = { seedOrders };

// 直接运行时执行
if (require.main === module) {
  (async function () {
    console.log('开始生成演示订单…');
    const r = await seedOrders({
      force: process.env.FORCE === '1',
      count: Number(process.env.COUNT || 48)
    });
    if (!r.skipped) {
      const s = await query('SELECT COUNT(*) c, COALESCE(SUM(total),0) amt FROM `order` WHERE status>=1');
      console.log(`\n✅ 订单数据就绪：已付款及以上 ${s[0].c} 笔，累计成交额 ¥${Number(s[0].amt).toFixed(2)}`);
      console.log('   后台「数据看板」的成交额、类目柱状图、近 7 日折线图现在都有数据了。');
    }
    process.exit(0);
  })().catch(function (e) { console.error('SEED ORDERS ERROR:', e); process.exit(1); });
}
