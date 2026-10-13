/* =====================================================================
 * 校园二手优选 · 演示版 mock 后端（纯浏览器，无需任何服务器）
 * - 内置商品 / 用户 / 行为数据
 * - 浏览器端实现「基于物品的协同过滤(Item-based CF)」推荐 + 冷启动兜底
 * - 用 localStorage 持久化：登录态 / 购物车 / 订单 / 地址 / 私信 / 发布
 * ===================================================================== */
(function () {
  'use strict';

  // ---------- 工具：可复现随机数（保证每次打开数据一致） ----------
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const rnd = mulberry32(20260903);
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const ri = (min, max) => Math.floor(min + rnd() * (max - min + 1));

  // ---------- 分类 ----------
  const CATS = [
    { id: 1, name: '图书教材' }, { id: 2, name: '数码电子' }, { id: 3, name: '宿舍好物' },
    { id: 4, name: '服饰鞋包' }, { id: 5, name: '运动户外' }, { id: 6, name: '美妆个护' },
    { id: 7, name: '文体票务' }, { id: 8, name: '其他' }
  ];
  const catName = (id) => (CATS.find(c => c.id === id) || {}).name || '未分类';

  // ---------- 商品名池（校园二手场景） ----------
  const NAMES = {
    1: ['高等数学（上）第七版', '线性代数教材', '大学英语四级真题', '数据结构（C语言版）', '计算机网络 谢希仁', '考研英语词汇', 'Python编程从入门到实践', '微观经济学原理'],
    2: ['iPad Air 2020 64G', '小米蓝牙耳机', '罗技无线鼠标', 'Kindle Paperwhite', '二手机械键盘', '佳能微单相机', 'iPhone充电宝', '戴尔显示器24寸'],
    3: ['宜家落地灯', '折叠收纳箱', '桌面小风扇', '加湿器静音款', '遮光床帘双层', '宿舍热水壶', '懒人沙发', '多功能插线板'],
    4: ['优衣库羽绒服', 'Nike运动鞋42码', '帆布双肩包', '冬季毛呢大衣', '李宁卫衣', '百搭牛仔裤', '小CK单肩包', '雪地靴37码'],
    5: ['瑜伽垫加厚', '羽毛球拍一对', '帐篷户外便携', '哑铃一对', '骑行头盔', '篮球斯伯丁', '登山杖', '健身弹力带'],
    6: ['雅诗兰黛小棕瓶', '防晒霜SPF50', '电动牙刷', '吹风机负离子', '面膜补水10片', '淡香水', '化妆刷套装', '护手霜'],
    7: ['演唱会门票×1', '电影院兑换券', '健身房月卡', '话剧演出票', '游乐园门票', '展览通票', 'KTV欢唱券', '书法体验课'],
    8: ['二手自行车', '电热水袋', '护眼台灯', '长柄雨伞', '保温杯', '20寸行李箱', '抱枕靠垫', '钥匙收纳盒']
  };
  const DESC = {
    1: '九成新，无笔记无涂画，期末复习刚需，可小刀。',
    2: '自用闲置，功能正常，配件齐全，便宜出。',
    3: '宿舍用过，干净整洁，搬走带不走了。',
    4: '穿过几次，版型好，洗过无破损。',
    5: '锻炼必备，成色新，喜欢运动的同学冲。',
    6: '拆封试用，效果不错，囤多了出掉。',
    7: '多买的票/券，日期有效，随时可用。',
    8: '日常小物，便宜好用，带走即可。'
  };
  const PRICE = { 1: [8, 55], 2: [60, 1500], 3: [15, 120], 4: [30, 400], 5: [20, 300], 6: [25, 380], 7: [20, 260], 8: [10, 200] };

  const NAME_POOL = ['小琳', '阿杰', '学妹', '学长', '可乐', '团子', '阿哲', '栗子', '大壮', '糖糖', '小北', '橙子的', '阿May', '墨墨', '胖虎', '欣欣', '阿浩', '柚子', '小鹿', 'CC'];

  // ---------- 生成用户（120） ----------
  const USERS = [];
  for (let i = 1; i <= 120; i++) {
    USERS.push({
      id: i,
      username: 'user' + String(i).padStart(3, '0'),
      nickname: i === 1 ? '小琳' : NAME_POOL[(i - 2) % NAME_POOL.length],
      email: i === 1 ? 'user001@campus.edu' : '',
      phone: i === 1 ? '13800000001' : '',
      role: 'user'
    });
  }
  const userById = (id) => USERS.find(u => u.id === id) || null;

  // ---------- 生成商品（64） ----------
  let PID = 0;
  const SEED_PRODUCTS = [];
  Object.keys(NAMES).forEach(cid => {
    NAMES[cid].forEach((title) => {
      PID++;
      const seller = USERS[ri(1, USERS.length - 1)];
      const [lo, hi] = PRICE[cid];
      SEED_PRODUCTS.push({
        id: PID,
        title,
        category_id: Number(cid),
        category_name: catName(Number(cid)),
        price: Number((lo + rnd() * (hi - lo)).toFixed(2)),
        stock: ri(1, 9),
        description: DESC[cid],
        seller_id: seller.id,
        seller_name: seller.nickname,
        status: 1,
        // 真实商品图（picsum 按 seed 稳定出图）；加载失败时前端会自动回退到本地生成的封面
        cover: 'https://picsum.photos/seed/campus' + (10000 + PID) + '/400/400',
        images: []
      });
    });
  });

  // 运行时商品（含用户发布的，存 localStorage）
  let PRODUCTS = SEED_PRODUCTS.slice();
  function loadPublished() {
    try {
      const p = JSON.parse(localStorage.getItem('demo_published') || '[]');
      if (Array.isArray(p) && p.length) PRODUCTS = PRODUCTS.concat(p);
    } catch (e) {}
  }
  loadPublished();
  const productById = (id) => PRODUCTS.find(p => p.id === Number(id)) || null;

  // ---------- 生成行为数据（喂给协同过滤） ----------
  // type: view=1, cart=2, favorite=3, buy=4（权重）
  const TYPE_W = { view: 1, cart: 2, favorite: 3, buy: 4 };
  const INTERACTIONS = [];
  function addInteraction(uid, pid, type) {
    if (!productById(pid)) return;
    INTERACTIONS.push({ user_id: uid, product_id: pid, type, score: TYPE_W[type] });
  }
  // 给每位用户分配「偏好类目」，并在偏好类目内产生密集交互 —— 这样同类目商品高度共现，
  // 协同过滤才能算出清晰可解释的相似度（推荐结果会集中在用户偏好的类目里）。
  const userCats = {};
  for (let u = 1; u <= 120; u++) {
    if (u === 1) userCats[u] = [1, 2]; // 演示账号 user001：偏好 图书教材 + 数码电子
    else {
      const a = ri(1, 8), b = ri(1, 8);
      userCats[u] = (a === b) ? [a, ri(1, 8)] : [a, b];
    }
  }
  const productsOfCat = (cid) => PRODUCTS.filter(p => p.category_id === cid);
  for (let u = 1; u <= 120; u++) {
    const cats = userCats[u];
    const n = ri(9, 14);
    const seen = new Set();
    for (let k = 0; k < n; k++) {
      let pid;
      if (rnd() < 0.72) {
        const pool = productsOfCat(cats[Math.floor(rnd() * cats.length)]);
        pid = pool[Math.floor(rnd() * pool.length)].id;
      } else {
        pid = ri(1, PRODUCTS.length);
      }
      if (seen.has(pid)) continue; seen.add(pid);
      const r = rnd();
      const type = r < 0.55 ? 'view' : r < 0.8 ? 'cart' : r < 0.93 ? 'favorite' : 'buy';
      addInteraction(u, pid, type);
    }
  }
  // 给演示账号 user001 固定一批“图书/数码”偏好，让推荐可解释
  [1, 2, 3, 9, 11, 13].forEach(pid => addInteraction(1, pid, 'favorite'));
  [1, 2, 3].forEach(pid => addInteraction(1, pid, 'buy'));

  // ---------- 协同过滤推荐（Item-based CF） ----------
  // 构建 物品 -> 交互用户集合
  const itemUsers = {};
  INTERACTIONS.forEach(it => {
    (itemUsers[it.product_id] = itemUsers[it.product_id] || new Set()).add(it.user_id);
  });
  function cosine(a, b) {
    if (!a || !b || !a.size || !b.size) return 0;
    let inter = 0; a.forEach(x => { if (b.has(x)) inter++; });
    return inter / Math.sqrt(a.size * b.size);
  }
  // 行为权重矩阵：物品 -> {userId: score}，与后端 recommend.js 用同一套「加权余弦」
  const itemUserScore = {};
  INTERACTIONS.forEach(it => {
    (itemUserScore[it.product_id] = itemUserScore[it.product_id] || {})[it.user_id] = it.score;
  });
  const SCORE_NAME = { 1: '浏览', 2: '加购', 3: '收藏', 4: '购买' };
  function cosineW(a, b) {
    if (!a || !b) return 0;
    let dot = 0, na = 0, nb = 0;
    for (const k in a) { na += a[k] * a[k]; if (b[k]) dot += a[k] * b[k]; }
    for (const k in b) nb += b[k] * b[k];
    if (na === 0 || nb === 0) return 0;
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
  }
  function recommendForUser(uid, limit) {
    limit = limit || 8;
    const pos = new Set(INTERACTIONS.filter(it => it.user_id === uid).map(it => it.product_id));
    // 冷启动：无行为 -> 返回全站热门（按行为数）
    if (!pos.size) {
      const pop = Object.keys(itemUsers).map(pid => ({ pid: Number(pid), c: itemUsers[pid].size }))
        .sort((a, b) => b.c - a.c).slice(0, limit).map(x => productById(x.pid)).filter(Boolean);
      return pop;
    }
    // 候选物品相似度聚合（与目标用户已交互物品的加权余弦相似度之和，公式同后端）
    const cand = {};
    PRODUCTS.forEach(p => {
      if (pos.has(p.id)) return;
      let s = 0;
      pos.forEach(pid => { s += cosineW(itemUserScore[pid], itemUserScore[p.id]); });
      if (s > 0) cand[p.id] = s;
    });
    const ranked = Object.keys(cand).map(pid => ({ pid: Number(pid), s: cand[pid] }))
      .sort((a, b) => b.s - a.s).slice(0, limit).map(x => productById(x.pid)).filter(Boolean);
    // 相似物品不足时，用同类目热门补齐（冷启动兜底）
    if (ranked.length < limit) {
      const sameCat = PRODUCTS.filter(p => !pos.has(p.id) && !ranked.find(r => r.id === p.id) && pos.size);
      // 取目标用户偏好类目
      const cats = new Set([...pos].map(pid => (productById(pid) || {}).category_id));
      sameCat.sort((a, b) => (cats.has(b.category_id) ? 1 : 0) - (cats.has(a.category_id) ? 1 : 0));
      for (const p of sameCat) { if (ranked.length >= limit) break; ranked.push(p); }
    }
    return ranked;
  }

  // ---------- 协同过滤「数据 + 举例」（后台算法面板用，公式与后端一致） ----------
  function cfInsight(sampleUid) {
    const nickname = (id) => (USERS.find(u => u.id === id) || {}).nickname || ('用户' + id);
    const title = (id) => (productById(id) || {}).title || ('商品' + id);
    const ids = Object.keys(itemUserScore).map(Number);
    const prodUsers = {};
    INTERACTIONS.forEach(it => { (prodUsers[it.product_id] = prodUsers[it.product_id] || new Set()).add(it.user_id); });

    const pairs = [];
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const sim = cosineW(itemUserScore[ids[i]], itemUserScore[ids[j]]);
        if (sim <= 0) continue;
        let co = 0;
        prodUsers[ids[i]].forEach(u => { if (prodUsers[ids[j]].has(u)) co++; });
        pairs.push({ a: ids[i], b: ids[j], sim, co });
      }
    }
    pairs.sort((x, y) => y.sim - x.sim || y.co - x.co);
    const topPairs = pairs.slice(0, 8).map(p => ({
      a: title(p.a), b: title(p.b), sim: Number(p.sim.toFixed(3)), coUsers: p.co
    }));

    const cnt = {};
    INTERACTIONS.forEach(r => { cnt[r.user_id] = (cnt[r.user_id] || 0) + 1; });
    let uid = Number(sampleUid) || 0;
    if (!uid || !cnt[uid]) uid = Number(Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a])[0] || 0);

    const history = INTERACTIONS.filter(r => r.user_id === uid);
    // 同一件商品可能有多条行为：与推荐引擎一致，按商品去重后再求相似度和
    const histByItem = new Map();
    history.forEach(h => {
      const cur = histByItem.get(h.product_id) || { score: 0, times: 0 };
      cur.times += 1;
      cur.score = Math.max(cur.score, h.score);
      histByItem.set(h.product_id, cur);
    });
    const pos = new Set(histByItem.keys());
    const cand = new Map();
    histByItem.forEach((meta, pid) => {
      const A = itemUserScore[pid];
      if (!A) return;
      ids.forEach(oid => {
        if (pos.has(oid)) return;
        const sim = cosineW(A, itemUserScore[oid]);
        if (sim <= 0) return;
        const cur = cand.get(oid) || { score: 0, reasons: [] };
        cur.score += sim;
        cur.reasons.push({ title: title(pid), sim: Number(sim.toFixed(3)), type: SCORE_NAME[meta.score] || '行为', times: meta.times });
        cand.set(oid, cur);
      });
    });
    const ranked = [...cand.entries()].sort((a, b) => b[1].score - a[1].score).slice(0, 5);

    return {
      interactions: INTERACTIONS.length,
      users: Object.keys(cnt).length,
      items: ids.length,
      pairs: pairs.length,
      topPairs,
      sample: {
        userId: uid,
        nickname: nickname(uid),
        history: history.map(h => ({ title: title(h.product_id), type: SCORE_NAME[h.score] || '行为', score: h.score })),
        reco: ranked.map(e => ({
          title: title(e[0]),
          score: Number(e[1].score.toFixed(3)),
          reasons: e[1].reasons.sort((a, b) => b.sim - a.sim).slice(0, 3)
        }))
      }
    };
  }

  // ---------- token（与前端解码方式一致：base64(JSON)） ----------
  function makeToken(obj) {
    try { return btoa(unescape(encodeURIComponent(JSON.stringify(obj)))); }
    catch (e) { return ''; }
  }
  function parseToken(t) {
    try { return JSON.parse(decodeURIComponent(escape(atob(t)))); } catch (e) { return null; }
  }
  function curUser(isAdmin) {
    const t = localStorage.getItem(isAdmin ? 'adminToken' : 'token');
    if (!t) return null;
    return parseToken(t);
  }

  // ---------- localStorage 状态 ----------
  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { localStorage.setItem(k, JSON.stringify(v)); }
  };
  function getCart() { return LS.get('demo_cart', []); }
  function setCart(a) { LS.set('demo_cart', a); }
  function getOrders() { return LS.get('demo_orders', []); }
  // 预置搜索日志：让「大家都在搜」一进站就有内容（"清空"只清自己的历史）
  const DEFAULT_SEARCH_LOGS = (function () {
    const src = [['考研英语', 5], ['iPad', 4], ['机械键盘', 3], ['自行车', 3], ['遮光床帘', 2], ['高等数学', 2], ['蓝牙耳机', 1], ['台灯', 1]];
    const out = [];
    let uid = 1;
    src.forEach(function (pair, i) {
      for (let k = 0; k < pair[1]; k++) {
        uid = (uid % 118) + 2;
        out.push({ user_id: uid, keyword: pair[0], created_at: fmtDate(new Date(Date.now() - (i * 5 + k) * 3600000)) });
      }
    });
    return out;
  })();
  function getSearchLogs() {
    // 只要别人的搜索记录没了就补回预置热搜（点清空只会清掉自己的历史，不会把热搜清空）
    let cur = LS.get('demo_search_logs', null);
    const hasOthers = Array.isArray(cur) && cur.some(function (x) { return x.user_id !== 1; });
    if (!hasOthers) {
      cur = (Array.isArray(cur) ? cur.filter(function (x) { return x.user_id === 1; }) : []).concat(DEFAULT_SEARCH_LOGS);
      LS.set('demo_search_logs', cur);
    }
    return cur;
  }
  // 统一日期格式：YYYY-MM-DD HH:mm
  function fmtDate(d) {
    const x = d || new Date(), q = (n) => String(n).padStart(2, '0');
    return x.getFullYear() + '-' + q(x.getMonth() + 1) + '-' + q(x.getDate()) + ' ' + q(x.getHours()) + ':' + q(x.getMinutes());
  }
  // 演示用历史订单：让成交额、图表、「我卖出的」一开始就有真实数据
  function seedOrders() {
    const cur = LS.get('demo_orders', null);
    if (Array.isArray(cur) && cur.length) return;   // 已经有订单就以真实操作为准
    if (!Array.isArray(cur)) LS.set('demo_orders', []);
    const orders = [];
    for (let i = 0; i < 64; i++) {
      const u = USERS[ri(1, USERS.length - 1)];
      const when = new Date(Date.now() - ri(0, 13) * 86400000 - ri(0, 23) * 3600000);
      const items = [];
      const n = ri(1, 3);
      for (let k = 0; k < n; k++) {
        const pr = PRODUCTS[ri(0, PRODUCTS.length - 1)];
        if (!pr || items.some((it) => it.product_id === pr.id)) continue;
        items.push({ product_id: pr.id, title: pr.title, price: pr.price, quantity: ri(1, 2) });
      }
      if (!items.length) continue;
      const total = items.reduce((a, it) => a + it.price * it.quantity, 0);
      orders.push({
        id: 500000 + i,
        order_no: 'CM' + (210000 + i),
        status: ri(1, 3),
        total: Number(total.toFixed(2)),
        items,
        created_at: fmtDate(when),
        ts: when.getTime(),
        buyer_id: u.id,
        buyer: {
          name: (userById(u.id) || {}).nickname || '同学',
          phone: '138' + String(ri(10000000, 99999999)),
          detail: '校园宿舍 ' + ri(1, 20) + ' 号楼 ' + ri(101, 620) + ' 室'
        }
      });
    }
    LS.set('demo_orders', orders);
  }
  // 图片压缩：等比缩到最长边 480，JPEG 0.72，避免 localStorage 超限
  function shrinkImage(file, maxSide) {
    maxSide = maxSide || 480;
    return new Promise((resolve) => {
      if (!file || typeof FileReader === 'undefined') return resolve('');
      try {
        const fr = new FileReader();
        fr.onload = () => {
          const img = new Image();
          img.onload = () => {
            const sc = Math.min(1, maxSide / Math.max(img.width || 1, img.height || 1));
            const w = Math.max(1, Math.round((img.width || 1) * sc));
            const h = Math.max(1, Math.round((img.height || 1) * sc));
            const cv = document.createElement('canvas');
            cv.width = w; cv.height = h;
            cv.getContext('2d').drawImage(img, 0, 0, w, h);
            resolve(cv.toDataURL('image/jpeg', 0.72));
          };
          img.onerror = () => resolve('');
          img.src = fr.result;
        };
        fr.onerror = () => resolve('');
        fr.readAsDataURL(file);
      } catch (e) { resolve(''); }
    });
  }
  function setOrders(a) { LS.set('demo_orders', a); }
  function allAddr() { return LS.get('demo_addresses', [{ id: 1, user_id: 1, name: '小琳', phone: '13800000001', detail: '学生公寓 3 号楼 502', is_default: true }]); }
  function getAddr(uid) { return allAddr().filter(a => a.user_id === uid); }
  function getMessages() { return LS.get('demo_messages', []); }
  function setMessages(a) { LS.set('demo_messages', a); }
  function getUsers() { return LS.get('demo_users', {}); }
  seedOrders();   // 首次进入时灌入演示订单

  // ---------- 公告（初始 3 条；管理员发布后追加，存 localStorage） ----------
  const DEFAULT_NOTICES = [
    { id: 3, title: '国庆假期交易须知', content: '假期期间请尽量选择校内或人流较多的地点当面交易，注意人身与财物安全。', created_at: '2026-09-15 09:30' },
    { id: 2, title: '二手教材回收活动', content: '图书馆一层大厅 9 月 20 日—9 月 30 日设有教材回收点，欢迎同学们发布与选购。', created_at: '2026-09-12 14:05' },
    { id: 1, title: '校园二手交易须知', content: '平台仅提供信息发布服务，请线下交易时注意人身与财物安全，谨防虚假付款截图等骗局。', created_at: '2026-09-10 10:00' }
  ];
  function getNotices() {
    let n = LS.get('demo_notices', null);
    if (!n || !n.length) { n = DEFAULT_NOTICES.slice(); LS.set('demo_notices', n); }
    return n;
  }
  function setNotices(a) { LS.set('demo_notices', a); }
  function nowStr() {
    const d = new Date(), p = (x) => String(x).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  // ---------- 手机号 11 位校验（与真实后端返回的文案完全一致） ----------
  function phoneError(phone, required) {
    const s = String(phone == null ? '' : phone).trim();
    if (!s) return required ? '请填写手机号（11 位）' : '';
    if (!/^\d+$/.test(s)) return '手机号只能是数字';
    if (s.length < 11) return `手机号需 11 位，还差 ${11 - s.length} 位`;
    if (s.length > 11) return `手机号超出 11 位（当前 ${s.length} 位），请检查`;
    return '';
  }

  // ---------- 路由分发 ----------
  async function routeApi(method, url, payload, isAdmin) {
    const clean = (url || '').split('?')[0].replace(/^\//, '');
    const parts = clean.split('/');
    const params = (method === 'get' && payload && payload.params) ? payload.params : {};
    const body = (method !== 'get') ? payload : {};

    // === 认证（账号一律去空格：空格不算有效字符） ===
    if (parts[0] === 'auth' && parts[1] === 'login') {
      const username = String(body.username == null ? '' : body.username).replace(/\s+/g, '');
      const password = body.password;
      if (!username) return { code: 1, msg: '请输入账号（不能只输入空格）' };
      if (!password) return { code: 1, msg: '请输入密码' };
      let u = null;
      if (username === 'user001' && password === '123456') u = userById(1);
      else {
        const reg = getUsers();
        if (reg[username] && reg[username].password === password) {
          const r = reg[username];
          u = { id: r.id, username: r.username, nickname: r.nickname, email: r.email, phone: r.phone, role: 'user' };
        }
      }
      // 与真实后端一致：不区分账号错还是密码错，统一提示
      if (!u) return { code: 1, msg: '账号或密码不正确' };
      return { code: 0, data: { token: makeToken({ id: u.id, username: u.username, role: 'user' }), user: u } };
    }
    if (parts[0] === 'auth' && parts[1] === 'register') {
      const reg = getUsers();
      const uname = String(body.username == null ? '' : body.username).replace(/\s+/g, '');
      if (!uname) return { code: 1, msg: '请输入账号（不能只输入空格）' };
      if (!body.password) return { code: 1, msg: '请输入密码' };
      { const pe = phoneError(body.phone, false); if (pe) return { code: 1, msg: pe }; }
      if (reg[uname]) return { code: 1, msg: '该账号已存在' };
      const id = 1000 + Object.keys(reg).length + 1;
      reg[uname] = { id, username: uname, password: body.password, nickname: body.nickname || uname, email: body.email || '', phone: body.phone || '' };
      LS.set('demo_users', reg);
      return { code: 0, msg: '注册成功' };
    }
    if (parts[0] === 'auth' && parts[1] === 'admin' && parts[2] === 'login') {
      const aname = String(body.username == null ? '' : body.username).replace(/\s+/g, '');
      if (!aname) return { code: 1, msg: '请输入管理员账号（不能只输入空格）' };
      if (!body.password) return { code: 1, msg: '请输入管理员密码' };
      if (aname === 'admin' && body.password === 'admin123')
        return { code: 0, data: { token: makeToken({ id: 0, username: 'admin', role: 'admin' }) } };
      return { code: 1, msg: '管理员账号或密码错误' };
    }

    // === 分类 ===
    if (parts[0] === 'category' && parts[1] === 'list') return { code: 0, data: CATS };

    // === 公告（公开接口：游客 / 普通用户 / 管理员都能读） ===
    if (parts[0] === 'notice' && parts[1] === 'list') {
      return { code: 0, data: getNotices().slice().sort((a, b) => b.id - a.id) };
    }

    // === 商品 ===
    if (parts[0] === 'product' && parts[1] === 'list') {
      let list = PRODUCTS.slice();
      if (params.category_id) list = list.filter(p => p.category_id === Number(params.category_id));
      if (params.keyword) {
        // 多个关键词（空格/逗号分隔）：命中任意一个即返回；命中的关键词越多排得越靠前（全命中优先）
        const terms = String(params.keyword).toLowerCase().split(/[\s,，、;；]+/).filter(Boolean).slice(0, 5);
        if (terms.length) {
          list = list.map(function (p) {
            const hay = (p.title + ' ' + (p.description || '') + ' ' + (p.category_name || '')).toLowerCase();
            let hit = 0;
            terms.forEach(function (t) { if (hay.indexOf(t) >= 0) hit++; });
            return { p: p, hit: hit };
          }).filter(function (x) { return x.hit > 0; })
            .sort(function (a, b) { return b.hit - a.hit; })
            .map(function (x) { return x.p; });
        }
      }
      list = list.filter(p => p.status === 1);
      const total = list.length;
      const page = Number(params.page) || 1, size = Number(params.size) || 12;
      const start = (page - 1) * size;
      return { code: 0, data: { list: list.slice(start, start + size), total } };
    }
    if (parts[0] === 'product' && parts[1] === 'detail') {
      const p = productById(parts[2]);
      if (!p) return { code: 1, msg: '商品不存在' };
      return { code: 0, data: p };
    }
    if (parts[0] === 'product' && parts[1] === 'favorite') {
      const u = curUser(false); if (!u) return { code: 401 };
      addInteraction(u.id, Number(parts[2]), 'favorite');
      return { code: 0 };
    }
    if (parts[0] === 'product' && parts[1] === 'publish') {
      const u = curUser(false); if (!u) return { code: 401 };
      const fd = body || {};
      const get = (k) => (fd.get ? fd.get(k) : fd[k]);
      const cid = Number(get('category_id')) || 8;
      let upImgs = [];
      try { upImgs = JSON.parse(get('images') || '[]'); } catch (e) { upImgs = []; }
      if (!Array.isArray(upImgs)) upImgs = [];
      const np = {
        id: 9000 + (PRODUCTS.length), title: get('title') || '未命名商品',
        category_id: cid, category_name: catName(cid),
        price: Number(get('price')) || 0, stock: Number(get('stock')) || 1,
        description: get('description') || '', seller_id: u.id, seller_name: u.nickname, status: 1,
        cover: upImgs[0] || '', images: upImgs
      };
      PRODUCTS.push(np);
      const pub = LS.get('demo_published', []); pub.push(np); LS.set('demo_published', pub);
      return { code: 0 };
    }

    // === 商品图片上传（演示版：压缩后以 dataURL 存本地） ===
    if (parts[0] === 'product' && parts[1] === 'image' && method === 'post') {
      const u = curUser(false); if (!u) return { code: 401 };
      const files = [];
      if (body && typeof body.getAll === 'function') body.getAll('images').forEach((f) => files.push(f));
      else if (body && body.images) files.push(body.images);
      const urls = [];
      for (const f of files.slice(0, 6)) {
        const d = await shrinkImage(f);
        if (d) urls.push(d);
      }
      return { code: 0, data: urls };
    }

    // === 搜索历史 / 热搜词 ===
    if (parts[0] === 'search' && parts[1] === 'log' && method === 'post') {
      const u = curUser(false); if (!u) return { code: 0 };   // 游客不记录
      const kw = String((body && body.keyword) || '').trim().slice(0, 30);
      if (!kw) return { code: 0 };
      const logs = getSearchLogs();
      logs.push({ user_id: u.id, keyword: kw, created_at: nowStr() });
      LS.set('demo_search_logs', logs);
      return { code: 0 };
    }
    if (parts[0] === 'search' && parts[1] === 'mine' && method === 'get') {
      const u = curUser(false); if (!u) return { code: 0, data: [] };
      const seen = [];
      getSearchLogs().filter((x) => x.user_id === u.id).reverse().forEach((x) => {
        if (!seen.includes(x.keyword)) seen.push(x.keyword);
      });
      return { code: 0, data: seen.slice(0, Number(params.limit) || 8) };
    }
    if (parts[0] === 'search' && parts[1] === 'mine' && method === 'delete') {
      const u = curUser(false); if (!u) return { code: 0 };
      LS.set('demo_search_logs', getSearchLogs().filter((x) => x.user_id !== u.id));
      return { code: 0 };
    }
    if (parts[0] === 'search' && parts[1] === 'hot' && method === 'get') {
      const m = {};
      getSearchLogs().forEach((x) => { m[x.keyword] = (m[x.keyword] || 0) + 1; });
      const data = Object.keys(m).map((k) => ({ keyword: k, count: m[k] }))
        .sort((a, b) => b.count - a.count).slice(0, Number(params.limit) || 8);
      return { code: 0, data };
    }

    // === 推荐（协同过滤） ===
    if (parts[0] === 'recommend' && parts[1] === 'for-you') {
      const u = curUser(false); if (!u) return { code: 401 };
      const data = recommendForUser(u.id, Number(params.limit) || 8);
      return { code: 0, data };
    }

    // === 购物车 ===
    if (parts[0] === 'cart' && parts[1] === 'add') {
      const u = curUser(false); if (!u) return { code: 401 };
      const p = productById(body.product_id); if (!p) return { code: 1, msg: '商品不存在' };
      const cart = getCart();
      const exist = cart.find(c => c.product_id === p.id);
      if (exist) exist.quantity = (exist.quantity || 1) + (Number(body.quantity) || 1);
      else cart.push({ id: p.id, product_id: p.id, title: p.title, price: p.price, quantity: Number(body.quantity) || 1, stock: p.stock, status: p.status });
      setCart(cart); return { code: 0 };
    }
    if (parts[0] === 'cart' && parts[1] === 'list') {
      const u = curUser(false); if (!u) return { code: 401 };
      return { code: 0, data: getCart() };
    }
    if (parts[0] === 'cart' && parts[1] === 'update') {
      const cart = getCart(); const it = cart.find(c => c.id === Number(parts[2]));
      if (it) it.quantity = Number(body.quantity) || 1; setCart(cart); return { code: 0 };
    }
    if (parts[0] === 'cart' && parts[1] && method === 'delete') {
      setCart(getCart().filter(c => c.id !== Number(parts[2]))); return { code: 0 };
    }

    // === 地址（按用户隔离，互不串门） ===
    if (parts[0] === 'user' && parts[1] === 'address' && method === 'get') {
      const u = curUser(false); if (!u) return { code: 401 };
      return { code: 0, data: getAddr(u.id) };
    }
    if (parts[0] === 'user' && parts[1] === 'address' && method === 'post') {
      const u = curUser(false); if (!u) return { code: 401 };
      if (!String(body.name || '').trim()) return { code: 1, msg: '请填写收货人姓名' };
      { const pe = phoneError(body.phone, true); if (pe) return { code: 1, msg: pe }; }
      if (!String(body.detail || '').trim()) return { code: 1, msg: '请填写详细地址' };
      const a = allAddr().slice();
      if (body.is_default) a.forEach(x => { if (x.user_id === u.id) x.is_default = 0; });
      a.push({
        id: Date.now(), user_id: u.id,
        name: String(body.name).trim(), phone: String(body.phone).trim(), detail: String(body.detail).trim(),
        is_default: body.is_default ? 1 : 0
      });
      LS.set('demo_addresses', a); return { code: 0 };
    }
    if (parts[0] === 'user' && parts[1] === 'address' && method === 'delete') {
      LS.set('demo_addresses', allAddr().filter(x => x.id !== Number(parts[2]))); return { code: 0 };
    }

    // === 订单 ===
    if (parts[0] === 'order' && parts[1] === 'create') {
      const u = curUser(false); if (!u) return { code: 401 };
      const items = (body.items || []).map(it => {
        const p = productById(it.product_id);
        return { product_id: it.product_id, title: p ? p.title : '商品', price: p ? p.price : 0, quantity: it.quantity };
      });
      const total = items.reduce((s, it) => s + it.price * it.quantity, 0);
      // 记录买家身份与收货地址，供卖家（商户）查看
      const addr = getAddr(u.id).find(a => a.id === Number(body.address_id));
      const order = {
        id: Date.now(), order_no: 'CM' + Date.now(), status: 0, total: Number(total.toFixed(2)),
        items, created_at: Date.now(), buyer_id: u.id,
        buyer: addr ? { name: addr.name, phone: addr.phone, detail: addr.detail } : null
      };
      const orders = getOrders(); orders.unshift(order); setOrders(orders);
      setCart([]); // 结算后清空购物车
      return { code: 0, data: { total: order.total, order_no: order.order_no } };
    }
    if (parts[0] === 'order' && parts[1] === 'list') {
      const u = curUser(false); if (!u) return { code: 401 };
      return { code: 0, data: getOrders().filter(o => o.buyer_id === u.id) };
    }
    if (parts[0] === 'order' && parts[1] === 'sold') {
      const u = curUser(false); if (!u) return { code: 401 };
      const res = getOrders()
        .filter(o => o.items.some(it => { const p = productById(it.product_id); return p && p.seller_id === u.id; }))
        .map(o => ({
          ...o,
          buyer_name: o.buyer ? o.buyer.name : '',
          buyer_phone: o.buyer ? o.buyer.phone : '',
          buyer_address: o.buyer ? o.buyer.detail : ''
        }));
      return { code: 0, data: res };
    }
    if (parts[0] === 'order' && ['pay', 'ship', 'confirm', 'cancel'].includes(parts[1]) && method === 'put') {
      const orders = getOrders(); const o = orders.find(x => x.id === Number(parts[2]));
      if (!o) return { code: 1, msg: '订单不存在' };
      const next = { pay: 1, ship: 2, confirm: 3, cancel: 4 }[parts[1]];
      o.status = next;
      if (parts[1] === 'ship') o.shipped_at = Date.now();
      if (parts[1] === 'confirm') o.finished_at = Date.now();
      setOrders(orders); return { code: 0 };
    }

    // === 个人资料 ===
    if (parts[0] === 'user' && parts[1] === 'profile' && method === 'get') {
      const u = curUser(false); if (!u) return { code: 401 };
      const base = userById(u.id) || {};
      const reg = getUsers()[u.username] || {};
      return { code: 0, data: { id: u.id, username: u.username, nickname: reg.nickname || base.nickname || u.username, email: reg.email || base.email || '', phone: reg.phone || base.phone || '' } };
    }
    if (parts[0] === 'user' && parts[1] === 'profile' && method === 'put') {
      const u = curUser(false); if (!u) return { code: 401 };
      { const pe = phoneError(body.phone, false); if (pe) return { code: 1, msg: pe }; }
      const reg = getUsers();
      if (reg[u.username]) Object.assign(reg[u.username], body); else reg[u.username] = Object.assign({ id: u.id, username: u.username, password: '' }, body);
      LS.set('demo_users', reg); return { code: 0 };
    }

    // === 私信 ===
    if (parts[0] === 'message' && parts[1] === 'contacts') {
      const u = curUser(false); if (!u) return { code: 401 };
      const msgs = getMessages().filter(m => m.from_id === u.id || m.to_id === u.id);
      const peers = {};
      msgs.forEach(m => {
        const peer = m.from_id === u.id ? m.to_id : m.from_id;
        if (!peers[peer] || m.created_at > peers[peer].last_time) {
          const pn = (userById(peer) || {}).nickname || ('用户' + peer);
          peers[peer] = { from_id: peer, to_id: u.id, nickname: pn, last_msg: m.content, last_time: m.created_at };
        }
      });
      return { code: 0, data: Object.values(peers).sort((a, b) => b.last_time - a.last_time) };
    }
    if (parts[0] === 'message' && parts[1] === 'talk') {
      const u = curUser(false); if (!u) return { code: 401 };
      const peer = Number(parts[2]);
      const list = getMessages().filter(m => (m.from_id === u.id && m.to_id === peer) || (m.from_id === peer && m.to_id === u.id))
        .sort((a, b) => a.created_at - b.created_at);
      return { code: 0, data: list };
    }
    if (parts[0] === 'message' && parts[1] === 'send') {
      const u = curUser(false); if (!u) return { code: 401 };
      const msgs = getMessages();
      msgs.push({ from_id: u.id, to_id: Number(body.to_id), content: body.content, created_at: Date.now() });
      setMessages(msgs); return { code: 0 };
    }

    // === 后台（仅管理员通道 isAdmin=true 才可进入，普通用户通道拿不到数据） ===
    if (isAdmin) {
      if (parts[0] === 'admin' && parts[1] === 'stats') {
        const orders = getOrders();
        const revenue = orders.filter(o => o.status >= 1).reduce((s, o) => s + o.total, 0);
        return { code: 0, data: { users: USERS.length, products: PRODUCTS.length, orders: orders.length, messages: getMessages().length, revenue: Number(revenue.toFixed(2)) } };
      }
      if (parts[0] === 'admin' && parts[1] === 'users') return { code: 0, data: USERS };
      if (parts[0] === 'admin' && parts[1] === 'products')
        return { code: 0, data: PRODUCTS.map(p => ({ id: p.id, title: p.title, seller: p.seller_name, price: p.price, status: p.status })) };
      if (parts[0] === 'admin' && parts[1] === 'interactions') {
        const data = INTERACTIONS.slice(-300).map(it => {
          const u = userById(it.user_id), p = productById(it.product_id);
          return { nickname: u ? u.nickname : ('用户' + it.user_id), title: p ? p.title : ('商品' + it.product_id), type: it.type, score: it.score };
        });
        return { code: 0, data };
      }
      if (parts[0] === 'admin' && parts[1] === 'cf-insight') {
        return { code: 0, data: cfInsight(params.user_id) };
      }
      if (parts[0] === 'admin' && parts[1] === 'charts') {
        const paid = getOrders().filter((o) => Number(o.status) >= 1);
        const catMap = {};
        paid.forEach((o) => (o.items || []).forEach((it) => {
          const pr = productById(it.product_id);
          const name = (pr && pr.category_name) || '未分类';
          const amt = (Number(it.price) || 0) * (Number(it.quantity) || 1);
          catMap[name] = catMap[name] || { name, cnt: 0, amount: 0 };
          catMap[name].cnt += Number(it.quantity) || 1;
          catMap[name].amount += amt;
        }));
        const byCategory = Object.keys(catMap).map((k) => catMap[k])
          .sort((a, b) => b.amount - a.amount)
          .map((x) => ({ name: x.name, cnt: x.cnt, amount: Number(x.amount.toFixed(2)) }));
        const buckets = {};
        paid.forEach((o) => {
          const day = String(o.created_at || '').slice(0, 10) || fmtDate(new Date(o.ts || Date.now())).slice(0, 10);
          buckets[day] = buckets[day] || { cnt: 0, amount: 0 };
          buckets[day].cnt += 1;
          buckets[day].amount += Number(o.total) || 0;
        });
        const byDay = [];
        for (let i = 6; i >= 0; i--) {
          const key = fmtDate(new Date(Date.now() - i * 86400000)).slice(0, 10);
          const hit = buckets[key];
          byDay.push({ day: key.slice(5), cnt: hit ? hit.cnt : 0, amount: hit ? Number(hit.amount.toFixed(2)) : 0 });
        }
        return { code: 0, data: { byCategory, byDay } };
      }
      if (parts[0] === 'admin' && parts[1] === 'product' && parts[2] && parts[3] === 'status') {
        const p = productById(parts[2]); if (p) p.status = Number(body.status); return { code: 0 };
      }
      if (parts[0] === 'admin' && parts[1] === 'notice' && method === 'post') {
        const title = String((body && body.title) || '').trim();
        const content = String((body && body.content) || '').trim();
        if (!title) return { code: 1, msg: '请填写公告标题' };
        if (!content) return { code: 1, msg: '请填写公告内容' };
        const list = getNotices();
        const id = list.reduce((m, n) => Math.max(m, n.id), 0) + 1;
        list.push({ id, title, content, created_at: nowStr() });
        setNotices(list);
        return { code: 0 };
      }
    }

    return { code: 1, msg: '演示版不支持该接口：' + clean };
  }

  // ---------- 暴露给 app.js：演示模式开关 + 模拟 axios 实例 ----------
  window.__DEMO__ = true;
  // 用户端与管理端是两条独立通道（真实后端也是），必须分开，否则后台管理接口会 401/不识别
  function makeApi(isAdmin) {
    return {
      request({ method, url, data, params }) {
        return new Promise((resolve) => {
          // 加一点延迟，让骨架屏 / 加载动画自然呈现
          setTimeout(() => {
            let out;
            // 兼容两种传参：params 单独传（与真实 axios 一致）或塞在 data 里（旧写法）
            const body = params ? Object.assign({}, (data && typeof data === 'object') ? data : {}, { params }) : data;
            try { out = routeApi(method, url, body, isAdmin); } catch (e) { out = { code: 1, msg: '演示数据错误' }; }
            // routeApi 可能是异步的（如图片上传），等它 resolve 后再交给前端
            Promise.resolve(out).then((v) => resolve({ data: v }));
          }, 140);
        });
      }
    };
  }
  window.__demoApi = makeApi(false);       // 普通用户
  window.__demoAdminApi = makeApi(true);   // 管理员
  // 保留旧接口名，避免外部脚本引用报错
  window.__demoCall = (method, url, data, isAdmin) =>
    new Promise((resolve) => {
      setTimeout(() => { try { resolve(routeApi(method, url, data, isAdmin)); } catch (e) { resolve({ code: 1, msg: '演示数据错误' }); } }, 140);
    });
})();
