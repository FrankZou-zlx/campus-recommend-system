/**
 * 演示数据灌入脚本（毕设专用）
 * 目的：没有真实用户也能演示「基于协同过滤的推荐」
 * 做法：生成 120 个模拟用户 + 60+ 商品，并让用户的浏览/收藏/加购/购买行为
 *      按「偏好类目」扎堆（喜欢数码的都看数码），从而协同过滤能算出真实商品相似度。
 *
 * 运行：在 backend 目录下  node sql/seed.js   （重新灌入加 FORCE=1）
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { query } = require('../src/db');

// 可复现的伪随机数（线性同余）
let _seed = 20260903;
function rnd() { _seed = (_seed * 1103515245 + 12345) & 0x7fffffff; return _seed / 0x7fffffff; }
function randInt(a, b) { return a + Math.floor(rnd() * (b - a + 1)); }
function pick(arr) { return arr[Math.floor(rnd() * arr.length)]; }

const CATEGORIES = ['数码电子', '图书教材', '服饰鞋包', '生活用品', '运动户外', '美妆个护'];

const PRODUCTS = {
  数码电子: ['无线蓝牙耳机', '机械键盘', '移动电源20000mAh', '二手iPad平板', '智能运动手表', '高清摄像头', '高速U盘128G', '千兆路由器', '便携蓝牙音箱', '游戏鼠标'],
  图书教材: ['高等数学(第七版)', '大学英语四级词汇', '数据结构(C语言版)', '计算机网络(谢希仁)', '线性代数', '考研政治真题', '概率论与数理统计', '操作系统概念', 'Python编程从入门到实践', 'C Primer Plus'],
  服饰鞋包: ['冬季加厚羽绒服', '经典帆布鞋', '大学生双肩背包', '连帽卫衣', '直筒牛仔裤', '针织毛线帽', '商务皮带', '纯棉运动袜(5双)', '帆布托特包', '防风冲锋衣'],
  生活用品: ['大容量收纳箱', '护眼LED台灯', '床上四件套', '保温杯500ml', '折叠晾衣架', '桌面垃圾桶', '薰衣草香薰', '全自动雨伞', '多孔插线板', '加湿器'],
  运动户外: ['加厚瑜伽垫', '可调节哑铃', '室内外篮球', '减震跑步鞋', '双人露营帐篷', '碳素登山杖', '计数跳绳', '加压护腕', '运动水壶', '弹力带'],
  美妆个护: ['补水保湿面膜', '氨基酸洗面奶', '哑光雾面口红', '清爽防晒霜SPF50', '无硅油洗发水', '身体乳保湿', '淡香水', '便携化妆镜', '电动牙刷', '男士护肤套装']
};

async function main() {
  // 防重复：已灌过则跳过
  const [uc] = await query('SELECT COUNT(*) c FROM user');
  if (uc.c > 5 && process.env.FORCE !== '1') {
    console.log('检测到已存在用户数据，跳过（如需重灌请执行 FORCE=1 node sql/seed.js）');
    process.exit(0);
  }

  console.log('清空旧数据...');
  await query('DELETE FROM interaction');
  await query('DELETE FROM cart');
  await query('DELETE FROM order_item');
  await query('DELETE FROM `order`');
  await query('DELETE FROM product_image');
  await query('DELETE FROM message');
  await query('DELETE FROM address');
  await query('DELETE FROM product');
  await query('DELETE FROM user WHERE role=0');
  await query('DELETE FROM category');
  // 重置自增：否则每次重灌分类 id 都会往后漂移（1..6 → 7..12），
  // 而之前发布的商品还指向旧 id，就会变成"未分类"的孤儿数据
  await query('ALTER TABLE category AUTO_INCREMENT = 1');

  // 1) 管理员（admin / admin123）
  const aHash = bcrypt.hashSync('admin123', 10);
  await query('INSERT INTO admin(username,password) VALUES(?,?) ON DUPLICATE KEY UPDATE password=?', ['admin', aHash, aHash]);

  // 2) 分类
  const catIds = [];
  for (const name of CATEGORIES) {
    const r = await query('INSERT INTO category(name,parent_id,sort) VALUES(?,0,?)', [name, catIds.length]);
    catIds.push(r.insertId);
  }
  console.log(`已建分类 ${catIds.length} 个`);

  // 3) 模拟用户 120 个（密码统一 123456，便于答辩演示登录）
  const uHash = bcrypt.hashSync('123456', 10);
  const userIds = [];
  for (let i = 1; i <= 120; i++) {
    const uname = 'user' + String(i).padStart(3, '0');
    const r = await query(
      'INSERT INTO user(username,password,nickname,role) VALUES(?,?,?,0)',
      [uname, uHash, '同学' + i]
    );
    userIds.push(r.insertId);
  }
  console.log(`已建模拟用户 ${userIds.length} 个`);

  // 4) 商品（每类 10 个，共 60 个），随机分配给模拟用户当卖家
  const productIds = [];
  for (let ci = 0; ci < CATEGORIES.length; ci++) {
    const names = PRODUCTS[CATEGORIES[ci]];
    for (const nm of names) {
      const price = (randInt(9, 499) + 0.9).toFixed(2);
      const seller = pick(userIds);
      const cover = `https://picsum.photos/seed/campus${ci}${randInt(1, 9999)}/400/400`;
      const r = await query(
        'INSERT INTO product(seller_id,category_id,title,description,price,stock,cover) VALUES(?,?,?,?,?,?,?)',
        [seller, catIds[ci], nm, `${nm} 九成新，校园自提或快递均可。`, price, randInt(1, 20), cover]
      );
      productIds.push({ id: r.insertId, cat: ci });
    }
  }
  console.log(`已建商品 ${productIds.length} 个`);

  // 5) 模拟行为：按「偏好类目」扎堆，让协同过滤有意义
  //    给每个用户随机分配 1~2 个偏好类目；偏好类目内高概率强行为，其它低概率弱行为
  const TYPE = { view: 1, favorite: 3, cart: 4, buy: 5 };
  let count = 0;
  for (const uid of userIds) {
    const favCats = new Set();
    const k = randInt(1, 2);
    while (favCats.size < k) favCats.add(randInt(0, CATEGORIES.length - 1));

    for (const p of productIds) {
      const inFav = favCats.has(p.cat);
      const prob = inFav ? 0.55 : 0.06;
      if (rnd() > prob) continue;
      // 偏好类目更可能购买，否则多为浏览
      let type;
      const roll = rnd();
      if (inFav) type = roll < 0.35 ? 'buy' : roll < 0.6 ? 'cart' : roll < 0.8 ? 'favorite' : 'view';
      else type = roll < 0.1 ? 'favorite' : 'view';
      await query(
        'INSERT INTO interaction(user_id,product_id,type,score) VALUES(?,?,?,?) ON DUPLICATE KEY UPDATE score=?',
        [uid, p.id, type, TYPE[type], TYPE[type]]
      );
      count++;
    }
  }
  console.log(`已生成用户-商品行为 ${count} 条`);

  // 6) 几条示例私信（让站内信有内容）
  await query('INSERT INTO message(from_id,to_id,content) VALUES(?,?,?)', [userIds[0], userIds[1], '你好，这个耳机还能便宜点吗？']);
  await query('INSERT INTO message(from_id,to_id,content) VALUES(?,?,?)', [userIds[1], userIds[0], '可以小刀，自提再送你一根数据线~']);

  // 7) 一条公告
  await query('INSERT INTO notice(title,content) VALUES(?,?)', ['校园二手交易须知', '请线下交易时注意人身与财物安全，平台仅提供信息发布服务。']);

  const [itc] = await query('SELECT COUNT(*) c FROM interaction');
  const [pc] = await query('SELECT COUNT(*) c FROM product');
  const [uc2] = await query('SELECT COUNT(*) c FROM user');
  console.log(`\n✅ 演示数据灌入完成：用户 ${uc2.c} / 商品 ${pc.c} / 行为 ${itc.c}`);
  console.log('后台账号：admin / admin123    模拟用户：user001~user120 / 123456');
  process.exit(0);
}

main().catch(e => { console.error('SEED ERROR:', e); process.exit(1); });
