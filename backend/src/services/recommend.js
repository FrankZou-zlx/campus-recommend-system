/**
 * 协同过滤推荐服务
 * ---------------------------------------------------------------------------
 * 算法：基于物品的协同过滤（Item-based Collaborative Filtering）
 * 数据来源：interaction 表，一行代表「某用户对某商品做过一次行为」，score 是行为权重
 *   （浏览=1、收藏=3、加购=4、购买=5，具体取值以写入端为准）
 *
 * 整体流程（itemCF）：
 *   1. 把 interaction 表整理成「商品 -> {用户: 行为分值}」向量，只保留在售商品
 *   2. 找出目标用户已经交互过的商品，这些商品不再推荐
 *   3. 统计目标用户的类目兴趣（只算收藏及以上的强行为）
 *   4. 用加权余弦相似度算「已交互商品」与「其它商品」的相似度，累加成推荐分
 *   5. 叠加类目兴趣加权，让数据稀疏时也能推出同类目商品
 *   6. 排序、截断；候选不足时用同类目热门、再全局热门补齐（冷启动兜底）
 *
 * 另提供 cfInsight()，把算法内部真实算出的中间结果摊开给管理端展示，
 * 用于答辩时解释「为什么推荐这件商品」。
 */
const { query } = require('../db');

// 行为分值与中文名的对应关系，管理端展示「推荐依据」时用
const BEHAVIOR_NAME = {
  1: '浏览',
  2: '加购',
  3: '收藏',
  4: '下单',
  5: '付款',
};

/**
 * 计算两个「用户 -> 分值」向量之间的余弦相似度。
 * 键是用户 id，值是行为权重；任意一侧为空向量时返回 0，避免除零。
 *
 * @param {Object} vectorA 商品 A 的用户行为向量
 * @param {Object} vectorB 商品 B 的用户行为向量
 * @returns {number} 0 到 1 之间的相似度
 */
function cosine(vectorA, vectorB) {
  let dotProduct = 0; // 分子：共同用户的行为权重乘积之和
  let squareSumA = 0; // 分母：向量 A 的模长平方
  let squareSumB = 0; // 分母：向量 B 的模长平方

  for (const userId in vectorA) {
    const weightA = vectorA[userId];
    squareSumA += weightA * weightA;

    const weightB = vectorB[userId];
    if (weightB) {
      dotProduct += weightA * weightB;
    }
  }

  for (const userId in vectorB) {
    const weightB = vectorB[userId];
    squareSumB += weightB * weightB;
  }

  if (squareSumA === 0 || squareSumB === 0) {
    return 0;
  }

  return dotProduct / (Math.sqrt(squareSumA) * Math.sqrt(squareSumB));
}

/**
 * 为指定用户生成推荐列表。
 *
 * @param {number} userId 目标用户 id
 * @param {number} limit  最多返回几条，传 0 时按 8 条处理
 * @returns {Promise<{list: Array, basis: Array<string>}>}
 *          list 是商品卡片数组，basis 是「基于你关注的类目」用的类目名列表
 */
async function itemCF(userId, limit = 8) {
  const resultLimit = limit || 8;

  const interactions = await query('SELECT user_id, product_id, score FROM interaction');
  // 必须 LEFT JOIN 分类表：前端商品卡要显示分类名，没图时还要按类目配色生成封面
  const products = await query(
    `SELECT p.id, p.category_id, p.title, p.price, p.cover, p.status, c.name AS category_name
     FROM product p LEFT JOIN category c ON p.category_id = c.id
     WHERE p.status = 1`
  );

  const productById = new Map();
  for (const product of products) {
    productById.set(product.id, product);
  }

  // 第一步：构建「商品 -> {用户: 行为分值}」向量，已下架商品不参与计算
  const itemUserVectors = {};
  for (const interaction of interactions) {
    if (!productById.has(interaction.product_id)) {
      continue;
    }
    if (!itemUserVectors[interaction.product_id]) {
      itemUserVectors[interaction.product_id] = {};
    }
    itemUserVectors[interaction.product_id][interaction.user_id] = interaction.score;
  }

  // 第二步：目标用户已交互过的商品（含已下架的，避免重复推荐）
  const interactedProductIds = new Set();
  for (const interaction of interactions) {
    if (interaction.user_id === userId) {
      interactedProductIds.add(interaction.product_id);
    }
  }

  // 第三步：类目兴趣权重。只统计收藏及以上的强行为（score >= 3），
  // 这样「收藏了数码就多推数码」才成立；单纯浏览不给类目加分。
  const categoryWeight = new Map();
  const interestCategoryNames = new Set();
  for (const interaction of interactions) {
    if (interaction.user_id !== userId) {
      continue;
    }
    if (interaction.score < 3) {
      continue;
    }
    const product = productById.get(interaction.product_id);
    if (!product) {
      continue;
    }
    const currentWeight = categoryWeight.get(product.category_id) || 0;
    categoryWeight.set(product.category_id, currentWeight + interaction.score);
    if (product.category_name) {
      interestCategoryNames.add(product.category_name);
    }
  }
  const basis = [...interestCategoryNames];

  // 第四步：协同过滤打分。对每件已交互商品，与其他未交互商品算加权余弦相似度，
  // 同一件候选商品被多次推中就把相似度累加起来（相似度求和，不再乘权重）。
  const similarityScoreByProduct = new Map();
  for (const sourceProductId of interactedProductIds) {
    const sourceVector = itemUserVectors[sourceProductId];
    if (!sourceVector) {
      continue;
    }

    for (const otherIdKey in itemUserVectors) {
      const otherProductId = Number(otherIdKey);
      if (otherProductId === sourceProductId) {
        continue;
      }
      if (interactedProductIds.has(otherProductId)) {
        continue;
      }

      const similarity = cosine(sourceVector, itemUserVectors[otherIdKey]);
      if (similarity <= 0) {
        continue;
      }

      const currentScore = similarityScoreByProduct.get(otherProductId) || 0;
      similarityScoreByProduct.set(otherProductId, currentScore + similarity);
    }
  }

  // 第五步：统计每件在售商品的交互次数，作为冷启动兜底的热度依据
  const interactionCountByProduct = new Map();
  for (const interaction of interactions) {
    if (!productById.has(interaction.product_id)) {
      continue;
    }
    const currentCount = interactionCountByProduct.get(interaction.product_id) || 0;
    interactionCountByProduct.set(interaction.product_id, currentCount + 1);
  }

  // 第六步：叠加类目兴趣加权。同类目商品会直接进入候选池，
  // 并按兴趣权重的 0.4 倍加分，保证稀疏数据下也有同类目结果可推。
  const finalScoreByProduct = new Map(similarityScoreByProduct);
  for (const product of products) {
    if (interactedProductIds.has(product.id)) {
      continue;
    }

    const categoryAffinity = categoryWeight.get(product.category_id) || 0;
    const alreadyScoredBySimilarity = finalScoreByProduct.has(product.id);
    if (categoryAffinity === 0 && !alreadyScoredBySimilarity) {
      continue;
    }

    const baseScore = finalScoreByProduct.get(product.id) || 0;
    finalScoreByProduct.set(product.id, baseScore + categoryAffinity * 0.4);
  }

  // 第七步：按得分从高到低排序，只保留商品 id
  const rankedProductIds = [...finalScoreByProduct.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([productId]) => productId);

  // 第八步：候选不够就补位。先补同类目热门，同类目也不够时再补全局热门。
  if (rankedProductIds.length < resultLimit) {
    const needCount = resultLimit - rankedProductIds.length;

    const interactedCategoryIds = new Set();
    for (const productId of interactedProductIds) {
      const product = productById.get(productId);
      if (product && product.category_id) {
        interactedCategoryIds.add(product.category_id);
      }
    }

    const fallbackCandidates = [];
    for (const product of products) {
      if (interactedProductIds.has(product.id)) {
        continue;
      }
      if (finalScoreByProduct.has(product.id)) {
        continue;
      }
      // 有类目偏好时只补同类目；完全没有类目信息时放宽到全部商品
      if (interactedCategoryIds.size > 0 && !interactedCategoryIds.has(product.category_id)) {
        continue;
      }
      fallbackCandidates.push(product);
    }

    fallbackCandidates.sort((left, right) => {
      const leftCount = interactionCountByProduct.get(left.id) || 0;
      const rightCount = interactionCountByProduct.get(right.id) || 0;
      return rightCount - leftCount;
    });

    for (const product of fallbackCandidates.slice(0, needCount)) {
      rankedProductIds.push(product.id);
    }
  }

  // 第九步：截断并组装成前端商品卡需要的结构，同时给出推荐理由
  const finalProductIds = rankedProductIds.slice(0, resultLimit);
  const list = [];
  for (const productId of finalProductIds) {
    const product = productById.get(productId);
    if (!product) {
      continue;
    }

    let reason = '同学都在看的同类好物';
    if (categoryWeight.get(product.category_id)) {
      reason = '因为你关注过「' + (product.category_name || '该类目') + '」类商品';
    } else if (similarityScoreByProduct.has(productId)) {
      reason = '与你交互过的商品相似';
    }

    list.push({
      id: product.id,
      title: product.title,
      price: product.price,
      cover: product.cover,
      category_id: product.category_id,
      category_name: product.category_name,
      reason,
    });
  }

  return { list, basis };
}

/**
 * 生成协同过滤「可解释性」数据，供管理端展示算法真实计算过程。
 * 返回三类信息：
 *   1. 行为矩阵规模：行为条数、参与用户数、被交互商品数、有效商品对数
 *   2. 相似度最高的商品对：用于解释「为什么把 A 和 B 排在一起」
 *   3. 抽样用户的推荐结果，以及每条结果由哪些已交互商品贡献了多少相似度
 *
 * @param {number} sampleUserId 指定的样例用户，传 0 时自动挑行为最多的用户
 */
async function cfInsight(sampleUserId) {
  const interactions = await query('SELECT user_id, product_id, score FROM interaction');
  const products = await query('SELECT id, title, category_id FROM product WHERE status=1');

  const productById = new Map();
  for (const product of products) {
    productById.set(product.id, product);
  }

  // 商品 -> {用户: 分值}，加权余弦用；同时记录 商品 -> 用户集合，用于统计共同用户数
  const itemUserVectors = {};
  const productUserSets = {};
  for (const interaction of interactions) {
    if (!productById.has(interaction.product_id)) {
      continue;
    }
    if (!itemUserVectors[interaction.product_id]) {
      itemUserVectors[interaction.product_id] = {};
      productUserSets[interaction.product_id] = new Set();
    }
    itemUserVectors[interaction.product_id][interaction.user_id] = interaction.score;
    productUserSets[interaction.product_id].add(interaction.user_id);
  }

  const activeProductIds = Object.keys(itemUserVectors).map(Number);

  // ---- 1) 两两计算商品相似度，取最相似的前 8 对 ----
  const similarPairs = [];
  for (let i = 0; i < activeProductIds.length; i++) {
    for (let j = i + 1; j < activeProductIds.length; j++) {
      const productIdA = activeProductIds[i];
      const productIdB = activeProductIds[j];

      const similarity = cosine(itemUserVectors[productIdA], itemUserVectors[productIdB]);
      if (similarity <= 0) {
        continue;
      }

      // 共同交互过的用户数，作为相似度的可信度参考
      let commonUserCount = 0;
      for (const userId of productUserSets[productIdA]) {
        if (productUserSets[productIdB].has(userId)) {
          commonUserCount += 1;
        }
      }

      similarPairs.push({
        productIdA,
        productIdB,
        similarity,
        commonUserCount,
      });
    }
  }

  similarPairs.sort((left, right) => {
    return right.similarity - left.similarity || right.commonUserCount - left.commonUserCount;
  });

  const topPairs = [];
  for (const pair of similarPairs.slice(0, 8)) {
    const productA = productById.get(pair.productIdA) || {};
    const productB = productById.get(pair.productIdB) || {};
    topPairs.push({
      a: productA.title || '商品' + pair.productIdA,
      b: productB.title || '商品' + pair.productIdB,
      sim: Number(pair.similarity.toFixed(3)),
      coUsers: pair.commonUserCount,
    });
  }

  // ---- 2) 选一个行为最丰富的用户作为展示样例 ----
  const behaviorCountByUser = {};
  for (const interaction of interactions) {
    const currentCount = behaviorCountByUser[interaction.user_id] || 0;
    behaviorCountByUser[interaction.user_id] = currentCount + 1;
  }

  let sampleId = Number(sampleUserId) || 0;
  if (!sampleId || !behaviorCountByUser[sampleId]) {
    const sortedUserIds = Object.keys(behaviorCountByUser).sort((left, right) => {
      return behaviorCountByUser[right] - behaviorCountByUser[left];
    });
    sampleId = Number(sortedUserIds[0] || 0);
  }

  // ---- 3) 用样例用户重算一遍推荐，并记录每条推荐的贡献来源 ----
  const sampleHistory = [];
  for (const interaction of interactions) {
    if (interaction.user_id === sampleId && productById.has(interaction.product_id)) {
      sampleHistory.push(interaction);
    }
  }

  // 同一件商品可能有多条行为（浏览 + 收藏 + 购买）：与 itemCF 一致，按商品去重后
  // 取最高权重作为行为分值，同时记录行为次数
  const historyByProduct = new Map();
  for (const interaction of sampleHistory) {
    const current = historyByProduct.get(interaction.product_id) || { score: 0, times: 0 };
    current.times += 1;
    current.score = Math.max(current.score, interaction.score);
    historyByProduct.set(interaction.product_id, current);
  }

  const interactedProductIds = new Set(historyByProduct.keys());

  const candidateScores = new Map();
  for (const [historyProductId, historyMeta] of historyByProduct) {
    const sourceVector = itemUserVectors[historyProductId];
    if (!sourceVector) {
      continue;
    }

    for (const candidateProductId of activeProductIds) {
      if (interactedProductIds.has(candidateProductId)) {
        continue;
      }

      const similarity = cosine(sourceVector, itemUserVectors[candidateProductId]);
      if (similarity <= 0) {
        continue;
      }

      let candidate = candidateScores.get(candidateProductId);
      if (!candidate) {
        candidate = { score: 0, reasons: [] };
        candidateScores.set(candidateProductId, candidate);
      }
      // 与 itemCF 的打分公式保持一致：相似度直接求和
      candidate.score += similarity;

      const historyProduct = productById.get(historyProductId) || {};
      candidate.reasons.push({
        title: historyProduct.title,
        sim: Number(similarity.toFixed(3)),
        type: BEHAVIOR_NAME[historyMeta.score] || '权重' + historyMeta.score,
        times: historyMeta.times,
      });
    }
  }

  const rankedCandidates = [...candidateScores.entries()]
    .sort((left, right) => right[1].score - left[1].score)
    .slice(0, 5);

  let sampleNickname = sampleId ? '用户' + sampleId : '暂无数据';
  if (sampleId) {
    const userRows = await query('SELECT nickname FROM user WHERE id=?', [sampleId]);
    if (userRows.length > 0 && userRows[0].nickname) {
      sampleNickname = userRows[0].nickname;
    }
  }

  const history = [];
  for (const interaction of sampleHistory) {
    const product = productById.get(interaction.product_id) || {};
    history.push({
      title: product.title,
      type: BEHAVIOR_NAME[interaction.score] || '行为',
      score: interaction.score,
    });
  }

  const recommendations = [];
  for (const [candidateProductId, candidate] of rankedCandidates) {
    const product = productById.get(candidateProductId) || {};
    candidate.reasons.sort((left, right) => right.sim - left.sim);
    recommendations.push({
      title: product.title || '商品' + candidateProductId,
      score: Number(candidate.score.toFixed(3)),
      reasons: candidate.reasons.slice(0, 3),
    });
  }

  return {
    interactions: interactions.length,
    users: Object.keys(behaviorCountByUser).length,
    items: activeProductIds.length,
    pairs: similarPairs.length,
    topPairs,
    sample: {
      userId: sampleId,
      nickname: sampleNickname,
      history,
      reco: recommendations,
    },
  };
}

module.exports = { itemCF, cfInsight };
