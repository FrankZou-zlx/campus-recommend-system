const { query } = require('../db');

// 余弦相似度：输入两个 {userId: weight} 向量
function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (const k in a) { na += a[k] * a[k]; if (b[k]) dot += a[k] * b[k]; }
  for (const k in b) nb += b[k] * b[k];
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * 基于物品的协同过滤（Item-based Collaborative Filtering）
 * 思路：
 *   1. 用 interaction 表（view=1/favorite=3/cart=4/buy=5）构建「商品-用户」分值矩阵
 *   2. 计算目标用户交互过的每件商品，与其它商品的余弦相似度
 *   3. 汇总得到候选商品得分，排除已交互商品，取 TopN
 *   4. 数据稀疏 / 冷启动：不足时退回「同类目热门 + 全局热门」兜底（混合推荐）
 */
async function itemCF(userId, limit = 8) {
  limit = limit || 8;
  const interactions = await query('SELECT user_id, product_id, score FROM interaction');
  // 注意：必须 JOIN 分类表取 category_name —— 前端商品卡要显示分类名、没图时还要按类目配色生成封面
  const products = await query(
    `SELECT p.id, p.category_id, p.title, p.price, p.cover, p.status, c.name AS category_name
     FROM product p LEFT JOIN category c ON p.category_id = c.id
     WHERE p.status = 1`
  );
  const prodMap = new Map(products.map(p => [p.id, p]));

  // 商品 -> {userId: score}
  const itemUsers = {};
  for (const r of interactions) {
    if (!prodMap.has(r.product_id)) continue; // 只取在售商品
    (itemUsers[r.product_id] = itemUsers[r.product_id] || {})[r.user_id] = r.score;
  }

  // 目标用户交互过的商品集合
  const userItems = new Set(interactions.filter(r => r.user_id === userId).map(r => r.product_id));

  // 候选得分：相似度加权
  const candScore = new Map();
  for (const iid of userItems) {
    if (!itemUsers[iid]) continue;
    for (const oid in itemUsers) {
      const other = Number(oid);
      if (other === iid || userItems.has(other)) continue; // 不推自己已交互的
      const sim = cosine(itemUsers[iid], itemUsers[oid]);
      if (sim > 0) candScore.set(other, (candScore.get(other) || 0) + sim);
    }
  }
  let ranked = [...candScore.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]);

  // 商品热度统计（用于冷启动兜底排序）
  const hotCount = {};
  for (const r of interactions) if (prodMap.has(r.product_id)) hotCount[r.product_id] = (hotCount[r.product_id] || 0) + 1;

  const exclude = new Set([...userItems, ...ranked]);
  if (ranked.length < limit) {
    const need = limit - ranked.length;
    // 优先同类目，再按热度
    const cats = new Set([...userItems].map(id => prodMap.get(id)?.category_id).filter(Boolean));
    let fb = products.filter(p => !exclude.has(p.id) && (cats.size ? cats.has(p.category_id) : true));
    fb.sort((a, b) => (hotCount[b.id] || 0) - (hotCount[a.id] || 0));
    ranked = ranked.concat(fb.slice(0, need).map(p => p.id));
  }

  const ids = ranked.slice(0, limit);
  const list = ids
    .map(id => {
      const p = prodMap.get(id);
      return p ? { id: p.id, title: p.title, price: p.price, cover: p.cover, category_id: p.category_id, category_name: p.category_name } : null;
    })
    .filter(Boolean);
  return list;
}

const TYPE_NAME = { 1: '浏览', 2: '加购', 3: '收藏', 4: '下单', 5: '付款' };

/**
 * 协同过滤「可解释性」数据（给后台管理端展示）
 * 把算法内部真实算出来的东西摊开：
 *   1. 行为矩阵规模（行为条数 / 参与用户数 / 被交互过的商品数 / 有效商品对数）
 *   2. 相似度最高的商品对（余弦相似度 + 共同交互用户数）—— 解释"为什么把 A 和 B 排在一起"
 *   3. 抽样用户的推荐结果 + 每条推荐的「推荐依据」（由哪些已交互商品贡献了多少相似度）
 */
async function cfInsight(sampleUserId) {
  const interactions = await query('SELECT user_id, product_id, score FROM interaction');
  const products = await query('SELECT id, title, category_id FROM product WHERE status=1');
  const prodMap = new Map(products.map(p => [p.id, p]));

  const itemUsers = {};   // 商品 -> {userId: score}（加权余弦用的向量）
  const prodUsers = {};   // 商品 -> Set(userId) （统计共同用户数/热度）
  for (const r of interactions) {
    if (!prodMap.has(r.product_id)) continue;
    (itemUsers[r.product_id] = itemUsers[r.product_id] || {})[r.user_id] = r.score;
    (prodUsers[r.product_id] = prodUsers[r.product_id] || new Set()).add(r.user_id);
  }
  const ids = Object.keys(itemUsers).map(Number);

  // 1) 相似度最高的商品对
  const pairs = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const sim = cosine(itemUsers[ids[i]], itemUsers[ids[j]]);
      if (sim <= 0) continue;
      let co = 0;
      prodUsers[ids[i]].forEach(u => { if (prodUsers[ids[j]].has(u)) co++; });
      pairs.push({ a: ids[i], b: ids[j], sim, co });
    }
  }
  pairs.sort((x, y) => y.sim - x.sim || y.co - x.co);
  const topPairs = pairs.slice(0, 8).map(p => ({
    a: (prodMap.get(p.a) || {}).title || ('商品' + p.a),
    b: (prodMap.get(p.b) || {}).title || ('商品' + p.b),
    sim: Number(p.sim.toFixed(3)),
    coUsers: p.co
  }));

  // 2) 选一个行为最丰富的用户做样例
  const cnt = {};
  for (const r of interactions) cnt[r.user_id] = (cnt[r.user_id] || 0) + 1;
  let uid = Number(sampleUserId) || 0;
  if (!uid || !cnt[uid]) uid = Number(Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a])[0] || 0);

  const history = interactions.filter(r => r.user_id === uid && prodMap.has(r.product_id));
  // 同一件商品可能有多条行为（浏览+收藏+购买）：与 itemCF 一致，按商品去重后再求相似度和
  const histByItem = new Map();
  for (const h of history) {
    const cur = histByItem.get(h.product_id) || { score: 0, times: 0 };
    cur.times += 1;
    cur.score = Math.max(cur.score, h.score);
    histByItem.set(h.product_id, cur);
  }
  const pos = new Set(histByItem.keys());
  const cand = new Map();
  for (const [pid, meta] of histByItem) {
    const A = itemUsers[pid];
    if (!A) continue;
    for (const oid of ids) {
      if (pos.has(oid)) continue;
      const sim = cosine(A, itemUsers[oid]);
      if (sim <= 0) continue;
      const cur = cand.get(oid) || { score: 0, reasons: [] };
      cur.score += sim;   // 与 itemCF 的打分公式完全一致：相似度求和
      cur.reasons.push({
        title: (prodMap.get(pid) || {}).title,
        sim: Number(sim.toFixed(3)),
        type: TYPE_NAME[meta.score] || ('权重' + meta.score),
        times: meta.times
      });
      cand.set(oid, cur);
    }
  }
  const ranked = [...cand.entries()].sort((a, b) => b[1].score - a[1].score).slice(0, 5);
  const userRow = uid ? await query('SELECT nickname FROM user WHERE id=?', [uid]) : [];
  const sample = {
    userId: uid,
    nickname: (userRow[0] && userRow[0].nickname) || (uid ? '用户' + uid : '暂无数据'),
    history: history.map(h => ({
      title: (prodMap.get(h.product_id) || {}).title,
      type: TYPE_NAME[h.score] || '行为',
      score: h.score
    })),
    reco: ranked.map(e => ({
      title: (prodMap.get(e[0]) || {}).title || ('商品' + e[0]),
      score: Number(e[1].score.toFixed(3)),
      reasons: e[1].reasons.sort((a, b) => b.sim - a.sim).slice(0, 3)
    }))
  };

  return {
    interactions: interactions.length,
    users: Object.keys(cnt).length,
    items: ids.length,
    pairs: pairs.length,
    topPairs,
    sample
  };
}

module.exports = { itemCF, cfInsight };
