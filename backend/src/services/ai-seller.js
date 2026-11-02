/**
 * AI 卖家自动回复服务（user.seller_mode = 'auto' 的账号视为「AI 卖家」）
 * ---------------------------------------------------------------------------
 * 设计目标：买家给 AI 卖家发私信时自动生成一条拟人回复，且不依赖任何付费服务
 *           （毕设零成本约束）。
 *
 * 两条生成通道，按顺序降级：
 *   1. LLM 通道（可选）：环境变量配了 AI_CHAT_BASE_URL 与 AI_CHAT_API_KEY
 *      （OpenAI 兼容接口）时，用大模型结合商品上下文生成回复；
 *   2. 规则引擎（默认）：本地意图识别 + 场景话术库，离线、无密钥也能演示。
 *   两条通道的输出最后都要过一遍敏感词过滤和商务边界审查（guardReply）。
 *
 * 回复边界（本模块最重要的约束）：
 *   - 可以回答：商品信息（标题/标价/成色/配件/库存/类目/描述）、
 *              物流进度（发货时间、快递方式、自提面交地点）、
 *              店铺服务（约见时间、交易流程指引）；
 *   - 一律禁止：改价让价议价、折扣、包邮或承担运费等价格承诺；
 *              退款退货赔付补差价等售后结果承诺；
 *              引导加微信、支付宝、私下转账等站外交易。
 *   即使 LLM 越界，输出层的 guardReply 也会把它替换成合规话术并写日志。
 *
 * 触发条件由调用方（routes/message.js）把关：收件人是 AI 卖家、非自聊、
 * 同一会话冷却未到、当日条数未超上限、AI 自己发的消息不再触发。
 */
const { query } = require('../db');
const { findSensitive } = require('../utils/sensitive');

// ---------------------------------------------------------------- 策略常量
const COOLDOWN_MS = 3000; // 同一会话两次 AI 回复的最小间隔
const DAILY_PAIR_LIMIT = 50; // 同一会话每日 AI 回复上限
const REPLY_DELAY_MIN = 600; // 模拟「正在输入」的最短延迟
const REPLY_DELAY_MAX = 1400; // 模拟「正在输入」的最长延迟
const MAX_REPLY_LEN = 300; // 单条回复最大长度

// 三类允许回答的问题域，用于日志与前端提示
const SCOPE = {
  product: '商品信息',
  logistics: '物流进度',
  service: '店铺服务',
};

// 红线关键词组：命中即视为「越界承诺」，整条回复替换为合规模板。
// 只拦「承诺句式」，正常陈述标价（如「页面标价 199 元」）不在此列。
const FORBIDDEN_OUTPUT = [
  {
    key: 'price_commit',
    label: '价格承诺',
    re: /(?:给|算|按|只要|就|再)\s*(?:你|您)?\s*\d+(?:\.\d+)?\s*(?:元|块)|\d+(?:\.\d+)?\s*折|(?:便宜|少|降|让)\s*\d+(?:\.\d+)?\s*(?:元|块)?|包邮|运费我(?:出|付)|邮费我(?:出|付)|免运费|最低(?:给你|卖)/,
  },
  {
    key: 'refund_commit',
    label: '退款赔付承诺',
    re: /(?:可以|支持|保证|承诺|包)\s*[^，。；]{0,6}(?:退款|退货|赔付|赔偿|补差价|换新)|包退|包赔|七天无理由/,
  },
  {
    key: 'offsite',
    label: '站外交易',
    re: /(?:加|扫|留)\s*[^，。；]{0,4}(?:微信|vx|v信|qq|二维码)|私下(?:转账|交易|付款)|支付宝转账|站外(?:交易|付款)/i,
  },
];

// 越界后的统一安全话术：既不承诺，也不冷场
const SAFE_REPLY = {
  price_commit: '价格这块我不能替卖家做主哦，页面标价就是卖家定的价，改价或优惠要他本人确认，我不做任何价格承诺～',
  refund_commit: '退款、退货和赔付需要走订单流程，由卖家本人处理并在订单里确认，我这边不能承诺结果，也不能替你申请赔偿。',
  offsite: '平台内下单和沟通就好啦，我不支持加微信、私下转账这类站外方式，这样对双方都没保障。',
  sensitive: '这个问题我稍后仔细回复你，你也可以先看看商品详情页的信息～',
  default: '我这边只负责商品信息、物流进度和店铺服务相关的问题；价格能不能改、退款赔付这些都需要卖家本人确认。',
};

// 判决「否定式表达」用的词表：命中位置前 8 个字内出现这些词，说明是合规拒绝
const NEGATION_PATTERN = /[不别没无勿]|拒绝|无法/;

// 进程内冷却记录：key 为「买家id:卖家id」，值为上次回复的时间戳
const lastReplyAt = new Map();

// ---------------------------------------------------------------- 意图规则
// 数组顺序即优先级：退款与站外最优先，问候类最后，
// 否则「你好，能便宜点吗」会被判成问候而不是议价。
const INTENT_RULES = [
  { key: 'refund', label: '退款赔付', scope: 'service', kw: ['退款', '退货', '赔付', '赔偿', '补差价', '包退', '包换', '售后', '坏了', '质量问题', '不想要了'] },
  { key: 'offsite', label: '站外交易', scope: 'service', kw: ['微信', '加v', 'vx', 'v信', '支付宝', '转账', '二维码', '私下'] },
  { key: 'bargain', label: '议价', scope: 'product', kw: ['便宜', '少点', '少一', '优惠', '刀', '降价', '让点', '让点价', '能少', '最低', '贵了', '打折', '划算点', '实惠点', '能便宜'] },
  { key: 'price', label: '询价', scope: 'product', kw: ['多少钱', '价格', '什么价', '几块', '几多', '报价', '售价', '多少出'] },
  { key: 'accessory', label: '配件', scope: 'product', kw: ['配件', '发票', '保修', '包装', '说明书', '原装', '数据线', '充电器'] },
  { key: 'stock', label: '库存', scope: 'product', kw: ['还有吗', '还有货', '现货', '库存', '还有几个', '还有几件', '有没有货', '卖掉了吗', '出掉了吗', '还在吗', '在了吗'] },
  { key: 'condition', label: '成色', scope: 'product', kw: ['几成新', '成色', '新旧', '磨损', '划痕', '用了多久', '用了多长', '破损', '瑕疵', '磕碰', '故障', '好不好用'] },
  { key: 'delivery', label: '物流', scope: 'logistics', kw: ['快递', '发货', '邮寄', '顺丰', '运费', '寄过来', '送到', '送吗', '能寄', '到货', '几天到', '包邮'] },
  { key: 'location', label: '面交', scope: 'logistics', kw: ['哪里', '在哪', '面交', '地点', '自提', '宿舍', '教学楼', '图书馆', '哪个校区', '怎么拿', '见面'] },
  { key: 'thanks', label: '致谢', scope: 'service', kw: ['谢谢', '感谢', '多谢', '麻烦了', '收到', '好的', '好嘞', 'ok'] },
  { key: 'greeting', label: '问候', scope: 'service', kw: ['你好', '您好', '在吗', '在么', '哈喽', 'hi', 'hello', '在不在', '打扰'] },
];

/**
 * 识别一句话的意图，返回命中的第一条规则（规则顺序即优先级）。
 *
 * @param {string} text 买家发来的原始内容
 * @returns {{intent: string, label: string, scope: string, hit: string, confidence: number}}
 */
function detectIntent(text) {
  const lowerText = String(text || '').toLowerCase().trim();

  for (const rule of INTENT_RULES) {
    const hitKeyword = rule.kw.find((keyword) => lowerText.includes(keyword));
    if (!hitKeyword) {
      continue;
    }

    // 关键词越长说明意图越明确，置信度相应提高，上限 0.95
    const confidence = Math.min(0.95, 0.6 + hitKeyword.length * 0.08);
    return {
      intent: rule.key,
      label: rule.label,
      scope: rule.scope,
      hit: hitKeyword,
      confidence: Number(confidence.toFixed(2)),
    };
  }

  return { intent: 'other', label: '其它', scope: 'product', hit: '', confidence: 0.3 };
}

// ---------------------------------------------------------------- 上下文
/**
 * 载入生成回复所需的上下文：卖家信息、在售商品列表、本次会话聚焦的商品。
 *
 * @param {number} sellerId 卖家 id
 * @param {number} productId 会话关联的商品 id，0 表示没有关联
 * @returns {Promise<{seller: Object, items: Array, focus: Object|null}>}
 */
async function loadContext(sellerId, productId) {
  const sellerRows = await query('SELECT id, nickname, seller_mode FROM `user` WHERE id = ?', [sellerId]);

  const items = await query(
    `SELECT p.id, p.title, p.price, p.stock, p.description, c.name AS category_name
       FROM product p LEFT JOIN category c ON p.category_id = c.id
      WHERE p.seller_id = ? AND p.status = 1
      ORDER BY p.created_at DESC
      LIMIT 30`,
    [sellerId]
  );

  const focusProductId = Number(productId) || 0;
  let focus = null;
  if (focusProductId) {
    focus = items.find((item) => Number(item.id) === focusProductId) || null;
  }
  // 只在售商品只有一件时，即使没传商品 id 也默认聚焦它
  if (!focus && items.length === 1) {
    focus = items[0];
  }

  let seller = sellerRows[0];
  if (!seller) {
    seller = { id: sellerId, nickname: '卖家' };
  }

  return { seller, items, focus };
}

// ---------------------------------------------------------------- 话术工具
/** 从候选话术里随机取一条，避免同一问题每次回复都一模一样 */
function pick(candidates) {
  return candidates[Math.floor(Math.random() * candidates.length)];
}

/** 价格展示：整数不带小数点，小数去掉末尾的 0 */
function formatPrice(value) {
  const price = Number(value);
  if (Number.isInteger(price)) {
    return `${price}`;
  }
  return price.toFixed(2).replace(/0$/, '');
}

/** 商品称呼：优先用聚焦商品的标题，没有就笼统说「这件东西」 */
function titleOf(ctx) {
  if (ctx.focus) {
    return ctx.focus.title;
  }
  return '这件东西';
}

// ---------------------------------------------------------------- 规则引擎
// 不依赖商品上下文、话术固定的意图，直接放在表里查
const FIXED_REPLIES = {
  bargain: [
    '价格我不能替你改哦～页面标价就是卖家定的，能不能优惠要卖家本人回复确认，我不做任何价格承诺。',
    '议价这块我真做不了主，改价、让价都得卖家本人点头，我只能把商品信息如实告诉你。',
  ],
  refund: [
    '退款、退货和赔付要走订单流程，由卖家本人处理并在订单里确认，我这边不能承诺结果。',
    '售后的事需要你和卖家在订单里走流程，我只能告诉你流程入口，不能替你答应退款或赔偿。',
  ],
  offsite: [
    '平台内下单和沟通就好啦，我不支持加微信、私下转账这类站外方式，对双方都没保障。',
    '建议就在平台里聊和下单，站外转账、加好友这种我没法配合，也容易出纠纷。',
  ],
  delivery: [
    '校内可以约面交；要发快递的话，运费和时效以商品页说明为准，具体由卖家本人确认，我不替他承诺包邮。',
    '同城/校内能约送，快递也能发，运费怎么算以商品页写的为准，我这边不做包邮承诺。',
  ],
  location: [
    '我就在校内，宿舍、教学楼、图书馆都能约，具体时间地点你和卖家定～',
    '支持面交，校内随便约个地方都行，我时间比较灵活。',
  ],
  accessory: [
    '原包装和配件都还在，说明书也留着，一起给你。',
    '配件齐全，包装也在，需要的话都一起给你。',
  ],
  thanks: ['不客气～有需要随时找我。', '好的，随时联系我哈。'],
};

/**
 * 规则引擎：按意图挑选话术，并把商品信息填进去。
 * 约束：任何分支都不得出现让价、折扣、包邮、退款赔付等承诺句式。
 *
 * @param {string} intent detectIntent 返回的意图 key
 * @param {Object} ctx loadContext 返回的上下文
 * @returns {string} 回复正文
 */
function ruleReply(intent, ctx) {
  const item = ctx.focus;
  const title = titleOf(ctx);
  const price = item ? formatPrice(item.price) : '';
  const stock = item ? Number(item.stock) : 0;
  const categoryName = item && item.category_name ? item.category_name : '';
  const description = item && item.description ? String(item.description) : '';

  // 1) 话术固定的意图，直接用候选表
  if (FIXED_REPLIES[intent]) {
    return pick(FIXED_REPLIES[intent]);
  }

  // 2) 询价：只能复述页面标价
  if (intent === 'price') {
    if (!item) {
      return pick([
        '你想问哪一件呀？我主页在售的商品都标了价，价格以商品页为准，看中哪个我再讲讲细节。',
        '我这几件都在商品页标了价，你说下具体是哪件，我把参数和成色讲清楚。',
      ]);
    }
    const stockText = stock > 1 ? `还有 ${stock} 件` : '就剩最后一件了';
    return pick([
      `${title} 页面标价 ${price} 元，${stockText}；价格以商品页为准，改价要走卖家本人确认。`,
      `${title} 是 ${price} 元，${stockText}，价格和库存都以商品页显示为准。`,
    ]);
  }

  // 3) 库存：按剩余件数分三种说法
  if (intent === 'stock') {
    if (!item) {
      return pick(['还有的，你想要哪件？', '在的，商品页能看到具体库存。']);
    }
    if (stock <= 0) {
      return pick([
        `这件刚好出完了，不过我还有其他${categoryName}的东西，你可以翻翻我的在售～`,
        `${title} 已经出掉啦，不好意思～要不看看我别的闲置？`,
      ]);
    }
    if (stock === 1) {
      return pick([
        `就剩最后一件啦，${title} 还在，要的话抓紧～`,
        `还有最后 1 件，${title} 一直留着，先到先得。`,
      ]);
    }
    return pick([
      `还有 ${stock} 件现货，${title} 随时可以出。`,
      `${title} 库存还有 ${stock} 件，够的～`,
    ]);
  }

  // 4) 成色：按描述里有没有「全新/九成」这类字眼分两种说法
  if (intent === 'condition') {
    if (!item) {
      return pick(['成色挺好的，我平时用得不多，有需要我可以再拍点细节图给你。']);
    }
    const looksNew = /全新|未拆|几乎全新|九成|9成/.test(description);
    if (looksNew) {
      return pick([
        `基本全新的，买来没怎么用，${title} 细节图我可以再拍给你看。`,
        `${title} 成色很好，一直好好放着，你放心。`,
      ]);
    }
    return pick([
      `${title} 平时用得比较少，成色不错，有小痕迹的地方我提前跟你说，细节图可以拍给你。`,
      `成色挺好的，正常使用痕迹，不影响用，介意的话我可以先拍细节图。`,
    ]);
  }

  // 5) 问候：有聚焦商品就顺带报一下在售状态
  if (intent === 'greeting') {
    if (item) {
      return pick([
        `你好～${title} 还在的，有什么想了解的？成色、配件、面交这些我都能说。`,
        `你好呀～${title} 还在售，想问什么直接说就行。`,
      ]);
    }
    return pick([
      '你好～有什么想了解的尽管问，我这几件闲置都还在售。',
      '你好呀～看中哪件跟我说，我给你讲讲细节。',
    ]);
  }

  // 6) 其它意图统一兜底，不做具体承诺
  if (item) {
    return pick([
      `收到～${title} 还在售，页面标价 ${price} 元，成色配件我都能补充，你还想了解哪方面？`,
      `好的，${title} 目前还在，具体情况我可以再补充，你想知道成色还是物流？`,
    ]);
  }
  return pick([
    '收到～你可以说下具体看中的商品，我把参数和成色讲清楚。',
    '我只回答商品信息、物流进度和店铺服务相关的问题，你先说看中哪件～',
  ]);
}

// ---------------------------------------------------------------- 输出边界审查
/**
 * 商务边界审查：拦下 AI 越界承诺（价格、退款赔付、站外交易）。
 * 带否定词的句子（「不做包邮承诺」「不支持加微信」）属于合规拒绝，不算违规：
 * 只要命中位置前 8 个字内出现否定词，就跳过这一处命中。
 *
 * @param {string} text 待审查的回复正文
 * @returns {{text: string, blocked: string}} blocked 为空串表示通过
 */
function guardReply(text) {
  const content = String(text || '');

  for (const rule of FORBIDDEN_OUTPUT) {
    const flags = rule.re.flags.includes('g') ? rule.re.flags : rule.re.flags + 'g';
    const pattern = new RegExp(rule.re.source, flags);

    for (const match of content.matchAll(pattern)) {
      const beforeText = content.slice(Math.max(0, match.index - 8), match.index);
      if (NEGATION_PATTERN.test(beforeText)) {
        continue;
      }
      return {
        text: SAFE_REPLY[rule.key] || SAFE_REPLY.default,
        blocked: rule.label,
      };
    }
  }

  return { text: content, blocked: '' };
}

// ---------------------------------------------------------------- LLM 通道
/** 是否启用了大模型通道（两个环境变量都配齐才算启用） */
function llmEnabled() {
  return !!(process.env.AI_CHAT_API_KEY && process.env.AI_CHAT_BASE_URL);
}

/**
 * 拼装系统提示词：把卖家身份、在售商品、回答范围与红线一次性交代清楚。
 */
function buildSystemPrompt(ctx) {
  const productLines = [];
  for (const item of ctx.items.slice(0, 10)) {
    let line = `- ${item.title}：标价 ${formatPrice(item.price)} 元，库存 ${item.stock}`;
    if (item.category_name) {
      line += `，类目 ${item.category_name}`;
    }
    productLines.push(line);
  }

  let focusLine = '';
  if (ctx.focus) {
    focusLine = `买家正在询问的商品：${ctx.focus.title}（标价 ${formatPrice(ctx.focus.price)} 元）。`;
  }

  return `你是校园二手交易平台的「店铺自动应答助手」，代卖家「${ctx.seller.nickname}」回复买家私信。
你的在售商品：
${productLines.join('\n') || '（暂无在售商品）'}
${focusLine}

【回答范围】只能回答以下三类问题：
1. 商品信息：标题、页面标价、成色、配件、库存、类目、描述；
2. 物流进度：发货时间、快递方式、自提/面交地点；
3. 店铺服务：约见时间、交易流程指引。
超出范围的问题，统一回复「这个需要卖家本人确认」。

【绝对禁止（违反即视为事故）】
1. 不得改价、让价、议价、打折，不得报出任何新的价格，不得承诺包邮或承担运费；
   买家问价时只能复述商品页标价，并说明「改价需卖家本人确认」。
2. 不得承诺退款、退货、赔付、赔偿、补差价等任何售后结果，只能说明走订单流程。
3. 不得引导加微信、支付宝、私下转账等站外交易。
4. 不得编造没有的商品、库存、参数或优惠活动。

【表达要求】口语化、亲切，像学生聊天，60 字以内；直接输出回复正文，不要加引号或解释。`;
}

/**
 * 调用 OpenAI 兼容接口生成一条回复，8 秒超时。
 * 任何异常都向上抛出，由调用方降级到规则引擎。
 */
async function llmReply(ctx, content, history) {
  const baseUrl = String(process.env.AI_CHAT_BASE_URL).replace(/\/+$/, '');
  const model = process.env.AI_CHAT_MODEL || 'gpt-4o-mini';

  const controller = new AbortController();
  const timeoutTimer = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.AI_CHAT_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: buildSystemPrompt(ctx) },
          ...history,
          { role: 'user', content },
        ],
        max_tokens: 200,
        temperature: 0.7,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const payload = await response.json();
    const firstChoice = payload && payload.choices && payload.choices[0];
    const replyText = firstChoice && firstChoice.message && firstChoice.message.content;
    if (!replyText) {
      throw new Error('空响应');
    }

    // 去掉模型爱加的首尾引号，并截断到最大长度
    return String(replyText).replace(/^["“]|["”]$/g, '').trim().slice(0, MAX_REPLY_LEN);
  } finally {
    clearTimeout(timeoutTimer);
  }
}

// ---------------------------------------------------------------- 对外接口
/** 判断某个用户是不是 AI 卖家（seller_mode = 'auto'） */
async function isAutoSeller(userId) {
  const rows = await query("SELECT seller_mode FROM `user` WHERE id = ?", [userId]);
  return rows.length > 0 && rows[0].seller_mode === 'auto';
}

/**
 * 冷却检查：距离上次回复不足 COOLDOWN_MS 时返回剩余毫秒数，否则返回 0。
 */
function cooldownLeft(buyerId, sellerId) {
  const key = `${buyerId}:${sellerId}`;
  const lastTime = lastReplyAt.get(key) || 0;
  const remaining = COOLDOWN_MS - (Date.now() - lastTime);
  return remaining > 0 ? remaining : 0;
}

/** 统计今天这对会话里 AI 已经发了几条，用于每日上限判断 */
async function dailyCount(buyerId, sellerId) {
  const rows = await query(
    `SELECT COUNT(*) AS total FROM message
      WHERE from_id = ? AND to_id = ? AND sender_type = 1 AND DATE(created_at) = CURDATE()`,
    [sellerId, buyerId]
  );
  if (rows.length === 0) {
    return 0;
  }
  return Number(rows[0].total);
}

/**
 * 取会话最近若干条消息，转成 LLM 需要的对话格式（按时间正序）。
 */
async function recentHistory(buyerId, sellerId, limit = 8) {
  const rows = await query(
    `SELECT from_id, content, sender_type FROM message
      WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)
      ORDER BY created_at DESC, id DESC LIMIT ?`,
    [buyerId, sellerId, sellerId, buyerId, limit]
  );

  // 数据库里是倒序取的，这里翻转回正序，再映射成 assistant / user 角色
  rows.reverse();

  const history = [];
  for (const message of rows) {
    history.push({
      role: message.from_id === sellerId ? 'assistant' : 'user',
      content: String(message.content || ''),
    });
  }
  return history;
}

/**
 * 生成一条 AI 回复（只生成文本，不写库）。
 * 顺序：LLM（可选）→ 规则引擎兜底 → 敏感词审查 → 商务边界审查。
 *
 * @param {{sellerId: number, buyerId: number, content: string, productId: number}} params
 * @returns {Promise<{content: string, intent: string, scope: string, source: string, confidence: number}>}
 */
async function generateReply({ sellerId, buyerId, content, productId = 0 }) {
  const ctx = await loadContext(sellerId, productId);
  const { intent, scope, confidence } = detectIntent(content);

  let replyText = '';
  let source = 'rule';

  if (llmEnabled()) {
    try {
      const history = await recentHistory(buyerId, sellerId, 8);
      // 最后一条就是本次提问，已经通过 content 传入，避免重复
      replyText = await llmReply(ctx, String(content || ''), history.slice(0, -1));
      source = 'llm';
    } catch (error) {
      console.warn('[ai-seller] LLM 通道失败，降级规则引擎：', error.message);
      replyText = '';
    }
  }

  if (!replyText) {
    replyText = ruleReply(intent, ctx);
    source = 'rule';
  }

  // 安全兜底一：违法违规内容，命中敏感词直接换安全话术
  if (findSensitive(replyText)) {
    console.warn('[ai-seller] 生成内容命中敏感词，已替换安全话术');
    replyText = SAFE_REPLY.sensitive;
    source = 'safe';
  }

  // 安全兜底二：商务边界，价格承诺 / 退款赔付 / 站外交易
  const guarded = guardReply(replyText);
  if (guarded.blocked) {
    console.warn(`[ai-seller] 生成内容越界（${guarded.blocked}），已替换为合规话术`);
    replyText = guarded.text;
    source = 'safe';
  }

  return {
    content: replyText.slice(0, MAX_REPLY_LEN),
    intent,
    scope,
    source,
    confidence,
  };
}

/** 模拟真人「正在输入」的随机延迟，单位毫秒 */
function replyDelay() {
  return REPLY_DELAY_MIN + Math.floor(Math.random() * (REPLY_DELAY_MAX - REPLY_DELAY_MIN));
}

/** 记录本次回复时间，供冷却检查使用 */
function markReplied(buyerId, sellerId) {
  lastReplyAt.set(`${buyerId}:${sellerId}`, Date.now());
}

module.exports = {
  detectIntent,
  loadContext,
  ruleReply,
  guardReply,
  generateReply,
  isAutoSeller,
  cooldownLeft,
  dailyCount,
  replyDelay,
  markReplied,
  llmEnabled,
  COOLDOWN_MS,
  DAILY_PAIR_LIMIT,
  INTENT_RULES,
  FORBIDDEN_OUTPUT,
  SCOPE,
};
