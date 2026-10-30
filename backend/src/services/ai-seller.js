/**
 * AI 卖家自动回复服务（seller_mode = 'auto'）
 * ---------------------------------------------------------------------------
 * 设计目标：买家给「auto 卖家」发私信时，系统自动生成一条拟人回复，实现
 *          智能问答 / 自动应答，且不依赖任何付费服务（毕设零成本约束）。
 *
 * 双层引擎（降级链）：
 *   1) LLM 通道（可选）：部署环境配置了 AI_CHAT_BASE_URL + AI_CHAT_API_KEY
 *      （OpenAI 兼容接口）时，用大模型结合商品上下文生成回复；
 *   2) 规则引擎（默认兜底）：本地意图识别 + 场景话术库。无需联网、无需密钥，
 *      保证虚拟机在完全离线或未配置密钥时依然可以正常演示。
 *   3) 安全兜底：两条通道的输出都会再过一遍敏感词过滤 + 商务边界审查
 *      （见 guardReply），命中红线则整体替换为合规模板。
 *
 * 【回复边界（本次修订的核心约束）】
 *   AI 只代表「店铺自动应答」，不代表卖家本人做出任何商务承诺，因此：
 *   - 允许回答：① 商品信息（标题/标价/成色/配件/库存/类目/描述）
 *               ② 物流进度（发货时间、快递方式、自提/面交地点）
 *               ③ 店铺服务（营业时间、约见方式、售后流程指引）
 *   - 一律禁止：改价、让价、议价、折扣、包邮/运费承诺、任何形式的报价承诺；
 *               退款、退货、赔付、补差价等售后结果承诺；
 *               引导加微信/支付宝/私下转账等站外交易。
 *   - 输出层再兜一道 guardReply：即使 LLM 越界，也会被替换成合规话术，
 *     并把命中原因写进日志（供内容审核与论文取证）。
 *
 * 触发条件（由 routes/message.js 调用方把关）：
 *   - 收件人 seller_mode = 'auto'（该账号即「AI 卖家」）
 *   - 发送方与收件人不是同一人（禁止自聊递归）
 *   - 同一会话 AI 回复间隔 >= COOLDOWN_MS（防刷屏）
 *   - 同一会话每日 AI 回复条数 < DAILY_PAIR_LIMIT
 *   - AI 自己发出的消息不再触发（sender_type=1 不参与触发）
 *
 * 输入：{ sellerId, buyerId, content, productId }
 * 输出：{ content, intent, scope, source: 'llm'|'rule'|'safe', confidence }
 */
const { query } = require('../db');
const { findSensitive } = require('../utils/sensitive');

// ---------------------------------------------------------------- 策略常量
const COOLDOWN_MS = 3000;             // 同一会话两次 AI 回复的最小间隔
const DAILY_PAIR_LIMIT = 50;          // 同一会话每日 AI 回复上限
const REPLY_DELAY_MIN = 600;          // 模拟「正在输入」的最短延迟
const REPLY_DELAY_MAX = 1400;         // 模拟「正在输入」的最长延迟
const MAX_REPLY_LEN = 300;            // 单条回复最大长度

// 三类允许回答的问题域（白名单，用于日志与前端提示）
const SCOPE = {
  product: '商品信息',
  logistics: '物流进度',
  service: '店铺服务',
};

// 红线关键词组：命中即视为「越界承诺」，整条替换为合规模板
// 注意：只拦「承诺句式」，正常陈述标价（如「页面标价 199 元」）不在此列
const FORBIDDEN_OUTPUT = [
  {
    key: 'price_commit',
    label: '价格承诺',
    re: /(?:给|算|按|只要|就|再)\s*(?:你|您)?\s*\d+(?:\.\d+)?\s*(?:元|块)|\d+(?:\.\d+)?\s*折|(?:便宜|少|降|让)\s*\d+(?:\.\d+)?\s*(?:元|块)?|包邮|运费我(?:出|付)|邮费我(?:出|付)|免运费|最低(?:给你|卖)/
  },
  {
    key: 'refund_commit',
    label: '退款赔付承诺',
    re: /(?:可以|支持|保证|承诺|包)\s*[^，。；]{0,6}(?:退款|退货|赔付|赔偿|补差价|换新)|包退|包赔|七天无理由/
  },
  {
    key: 'offsite',
    label: '站外交易',
    re: /(?:加|扫|留)\s*[^，。；]{0,4}(?:微信|vx|v信|qq|二维码)|私下(?:转账|交易|付款)|支付宝转账|站外(?:交易|付款)/i
  },
];

// 越界后的统一安全话术（按命中类型给出，既不承诺也不冷场）
const SAFE_REPLY = {
  price_commit: '价格这块我不能替卖家做主哦，页面标价就是卖家定的价，改价或优惠要他本人确认，我不做任何价格承诺～',
  refund_commit: '退款、退货和赔付需要走订单流程，由卖家本人处理并在订单里确认，我这边不能承诺结果，也不能替你申请赔偿。',
  offsite: '平台内下单和沟通就好啦，我不支持加微信、私下转账这类站外方式，这样对双方都没保障。',
  sensitive: '这个问题我稍后仔细回复你，你也可以先看看商品详情页的信息～',
  default: '我这边只负责商品信息、物流进度和店铺服务相关的问题；价格能不能改、退款赔付这些都需要卖家本人确认。',
};

// 进程内冷却记录：key = `${buyerId}:${sellerId}` -> 上次回复时间戳
const lastReplyAt = new Map();

// ---------------------------------------------------------------- 意图规则
// 数组顺序即优先级：退款/站外/砍价最优先，问候类最后（避免「你好，能便宜点吗」被判成问候）
const INTENT_RULES = [
  { key: 'refund',    label: '退款赔付', scope: 'service', kw: ['退款', '退货', '赔付', '赔偿', '补差价', '包退', '包换', '售后', '坏了', '质量问题', '不想要了'] },
  { key: 'offsite',   label: '站外交易', scope: 'service', kw: ['微信', '加v', 'vx', 'v信', '支付宝', '转账', '二维码', '私下'] },
  { key: 'bargain',   label: '议价',     scope: 'product', kw: ['便宜', '少点', '少一', '优惠', '刀', '降价', '让点', '让点价', '能少', '最低', '贵了', '打折', '划算点', '实惠点', '包邮吗', '能便宜'] },
  { key: 'price',     label: '询价',     scope: 'product', kw: ['多少钱', '价格', '什么价', '几块', '几多', '报价', '售价', '多少出'] },
  { key: 'accessory', label: '配件',     scope: 'product', kw: ['配件', '发票', '保修', '包装', '说明书', '原装', '数据线', '充电器'] },
  { key: 'stock',     label: '库存',     scope: 'product', kw: ['还有吗', '还有货', '现货', '库存', '还有几个', '还有几件', '有没有货', '卖掉了吗', '出掉了吗', '还在吗', '在了吗'] },
  { key: 'condition', label: '成色',     scope: 'product', kw: ['几成新', '成色', '新旧', '磨损', '划痕', '用了多久', '用了多长', '破损', '瑕疵', '磕碰', '故障', '好不好用'] },
  { key: 'delivery',  label: '物流',     scope: 'logistics', kw: ['快递', '发货', '邮寄', '顺丰', '运费', '寄过来', '送到', '送吗', '能寄', '到货', '几天到'] },
  { key: 'location',  label: '面交',     scope: 'logistics', kw: ['哪里', '在哪', '面交', '地点', '自提', '宿舍', '教学楼', '图书馆', '哪个校区', '怎么拿', '见面'] },
  { key: 'thanks',    label: '致谢',     scope: 'service', kw: ['谢谢', '感谢', '多谢', '麻烦了', '收到', '好的', '好嘞', 'ok'] },
  { key: 'greeting',  label: '问候',     scope: 'service', kw: ['你好', '您好', '在吗', '在么', '哈喽', 'hi', 'hello', '在不在', '打扰'] },
];

/**
 * 意图识别：返回首个命中的意图（规则顺序即优先级）
 * @returns {{intent:string,label:string,scope:string,hit:string,confidence:number}}
 */
function detectIntent(text) {
  const t = String(text || '').toLowerCase().trim();
  for (const rule of INTENT_RULES) {
    const hit = rule.kw.find((k) => t.includes(k));
    if (hit) {
      const confidence = Math.min(0.95, 0.6 + hit.length * 0.08);
      return { intent: rule.key, label: rule.label, scope: rule.scope, hit, confidence: Number(confidence.toFixed(2)) };
    }
  }
  return { intent: 'other', label: '其它', scope: 'product', hit: '', confidence: 0.3 };
}

// ---------------------------------------------------------------- 上下文
/**
 * 载入 AI 回复所需的上下文：卖家信息 + 在售商品 + 当前会话聚焦商品
 * @param {number} sellerId
 * @param {number} productId 会话关联商品（可为 0）
 */
async function loadContext(sellerId, productId) {
  const [seller] = await query(
    'SELECT id, nickname, seller_mode FROM `user` WHERE id = ?',
    [sellerId]
  );
  const items = await query(
    `SELECT p.id, p.title, p.price, p.stock, p.description, c.name AS category_name
       FROM product p LEFT JOIN category c ON p.category_id = c.id
      WHERE p.seller_id = ? AND p.status = 1
      ORDER BY p.created_at DESC
      LIMIT 30`,
    [sellerId]
  );
  let focus = null;
  const pid = Number(productId) || 0;
  if (pid) focus = items.find((i) => Number(i.id) === pid) || null;
  if (!focus && items.length === 1) focus = items[0];
  return { seller: seller || { id: sellerId, nickname: '卖家' }, items, focus };
}

// ---------------------------------------------------------------- 话术工具
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const yuan = (v) => {
  const n = Number(v);
  return Number.isInteger(n) ? `${n}` : n.toFixed(2).replace(/0$/, '');
};

/** 商品称呼：优先用聚焦商品标题，否则用总称 */
function titleOf(ctx) {
  return ctx.focus ? ctx.focus.title : '这件东西';
}

// ---------------------------------------------------------------- 规则引擎
/**
 * 规则引擎：按意图挑选话术并填充商品信息
 * 约束：任何分支都不得给出价格让让、折扣、包邮、退款赔付等承诺句式。
 * @returns {string}
 */
function ruleReply(intent, ctx) {
  const item = ctx.focus;
  const title = titleOf(ctx);
  const price = item ? yuan(item.price) : '';
  const stock = item ? Number(item.stock) : 0;
  const cat = item && item.category_name ? item.category_name : '';
  const desc = item && item.description ? String(item.description) : '';

  switch (intent) {
    case 'bargain': {
      return pick([
        `价格我不能替你改哦～页面标价就是卖家定的，能不能优惠要卖家本人回复确认，我不做任何价格承诺。`,
        `议价这块我真做不了主，改价、让价都得卖家本人点头，我只能把商品信息如实告诉你。`,
      ]);
    }
    case 'price': {
      if (!item) {
        return pick([
          '你想问哪一件呀？我主页在售的商品都标了价，价格以商品页为准，看中哪个我再讲讲细节。',
          '我这几件都在商品页标了价，你说下具体是哪件，我把参数和成色讲清楚。',
        ]);
      }
      const stockTail = stock > 1 ? `还有 ${stock} 件` : '就剩最后一件了';
      return pick([
        `${title} 页面标价 ${price} 元，${stockTail}；价格以商品页为准，改价要走卖家本人确认。`,
        `${title} 是 ${price} 元，${stockTail}，价格和库存都以商品页显示为准。`,
      ]);
    }
    case 'refund': {
      return pick([
        '退款、退货和赔付要走订单流程，由卖家本人处理并在订单里确认，我这边不能承诺结果。',
        '售后的事需要你和卖家在订单里走流程，我只能告诉你流程入口，不能替你答应退款或赔偿。',
      ]);
    }
    case 'offsite': {
      return pick([
        '平台内下单和沟通就好啦，我不支持加微信、私下转账这类站外方式，对双方都没保障。',
        '建议就在平台里聊和下单，站外转账、加好友这种我没法配合，也容易出纠纷。',
      ]);
    }
    case 'stock': {
      if (!item) {
        return pick(['还有的，你想要哪件？', '在的，商品页能看到具体库存。']);
      }
      if (stock <= 0) {
        return pick([
          `这件刚好出完了，不过我还有其他${cat || ''}的东西，你可以翻翻我的在售～`,
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
    case 'condition': {
      const fresh = /全新|未拆|几乎全新|九成|9成/.test(desc);
      if (!item) {
        return pick(['成色挺好的，我平时用得不多，有需要我可以再拍点细节图给你。']);
      }
      return fresh
        ? pick([
            `基本全新的，买来没怎么用，${title} 细节图我可以再拍给你看。`,
            `${title} 成色很好，一直好好放着，你放心。`,
          ])
        : pick([
            `${title} 平时用得比较少，成色不错，有小痕迹的地方我提前跟你说，细节图可以拍给你。`,
            `成色挺好的，正常使用痕迹，不影响用，介意的话我可以先拍细节图。`,
          ]);
    }
    case 'delivery': {
      return pick([
        '校内可以约面交；要发快递的话，运费和时效以商品页说明为准，具体由卖家本人确认，我不替他承诺包邮。',
        '同城/校内能约送，快递也能发，运费怎么算以商品页写的为准，我这边不做包邮承诺。',
      ]);
    }
    case 'location': {
      return pick([
        '我就在校内，宿舍、教学楼、图书馆都能约，具体时间地点你和卖家定～',
        '支持面交，校内随便约个地方都行，我时间比较灵活。',
      ]);
    }
    case 'accessory': {
      return pick([
        '原包装和配件都还在，说明书也留着，一起给你。',
        '配件齐全，包装也在，需要的话都一起给你。',
      ]);
    }
    case 'thanks': {
      return pick(['不客气～有需要随时找我。', '好的，随时联系我哈。']);
    }
    case 'greeting': {
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
    default: {
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
  }
}

// ---------------------------------------------------------------- 输出边界审查
/**
 * 商务边界审查：拦下 AI 越界承诺（价格 / 退款赔付 / 站外交易）
 * 说明：带否定词的句子（「不做包邮承诺」「不支持加微信」）属于合规拒绝，
 *      不判违规——命中位置前 8 个字内出现否定词即跳过该处命中。
 * @returns {{text:string, blocked:string}} blocked 为空串表示通过
 */
function guardReply(text) {
  const t = String(text || '');
  const NEG = /[不别没无勿]|拒绝|无法/;
  for (const rule of FORBIDDEN_OUTPUT) {
    const re = new RegExp(rule.re.source, rule.re.flags.includes('g') ? rule.re.flags : rule.re.flags + 'g');
    let m;
    while ((m = re.exec(t)) !== null) {
      const before = t.slice(Math.max(0, m.index - 8), m.index);
      if (NEG.test(before)) {           // 是否定式表达，属于合规拒绝
        if (m.index === re.lastIndex) re.lastIndex++;
        continue;
      }
      return { text: SAFE_REPLY[rule.key] || SAFE_REPLY.default, blocked: rule.label };
    }
  }
  return { text: t, blocked: '' };
}

// ---------------------------------------------------------------- LLM 通道
function llmEnabled() {
  return !!(process.env.AI_CHAT_API_KEY && process.env.AI_CHAT_BASE_URL);
}

function buildSystemPrompt(ctx) {
  const list = ctx.items.slice(0, 10)
    .map((i) => `- ${i.title}：标价 ${yuan(i.price)} 元，库存 ${i.stock}${i.category_name ? '，类目 ' + i.category_name : ''}`)
    .join('\n');
  const focusLine = ctx.focus ? `买家正在询问的商品：${ctx.focus.title}（标价 ${yuan(ctx.focus.price)} 元）。` : '';
  return `你是校园二手交易平台的「店铺自动应答助手」，代卖家「${ctx.seller.nickname}」回复买家私信。
你的在售商品：
${list || '（暂无在售商品）'}
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

async function llmReply(ctx, content, history) {
  const base = String(process.env.AI_CHAT_BASE_URL).replace(/\/+$/, '');
  const model = process.env.AI_CHAT_MODEL || 'gpt-4o-mini';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(`${base}/chat/completions`, {
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
      signal: ctrl.signal,
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    const txt = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
    if (!txt) throw new Error('空响应');
    return String(txt).replace(/^["“]|["”]$/g, '').trim().slice(0, MAX_REPLY_LEN);
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------- 对外接口
/** 判断某用户是否为 AI 卖家（卖家角色为 auto） */
async function isAutoSeller(userId) {
  const rows = await query("SELECT seller_mode FROM `user` WHERE id = ?", [userId]);
  return rows.length > 0 && rows[0].seller_mode === 'auto';
}

/** 冷却检查：命中则返回剩余毫秒数，未命中返回 0 */
function cooldownLeft(buyerId, sellerId) {
  const key = `${buyerId}:${sellerId}`;
  const last = lastReplyAt.get(key) || 0;
  const left = COOLDOWN_MS - (Date.now() - last);
  return left > 0 ? left : 0;
}

/** 每日上限检查：统计当日该会话 AI 已发条数 */
async function dailyCount(buyerId, sellerId) {
  const rows = await query(
    `SELECT COUNT(*) AS n FROM message
      WHERE from_id = ? AND to_id = ? AND sender_type = 1 AND DATE(created_at) = CURDATE()`,
    [sellerId, buyerId]
  );
  return rows.length ? Number(rows[0].n) : 0;
}

/** 取会话最近若干条（用于 LLM 上下文），按时间正序返回 */
async function recentHistory(buyerId, sellerId, limit = 8) {
  const rows = await query(
    `SELECT from_id, content, sender_type FROM message
      WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)
      ORDER BY created_at DESC, id DESC LIMIT ?`,
    [buyerId, sellerId, sellerId, buyerId, limit]
  );
  return rows.reverse().map((m) => ({
    role: m.from_id === sellerId ? 'assistant' : 'user',
    content: String(m.content || ''),
  }));
}

/**
 * 生成一条 AI 回复（不做落库）
 * @returns {Promise<{content:string,intent:string,scope:string,source:string,confidence:number}>}
 */
async function generateReply({ sellerId, buyerId, content, productId = 0 }) {
  const ctx = await loadContext(sellerId, productId);
  const { intent, scope, confidence } = detectIntent(content);

  let text = '';
  let source = 'rule';

  if (llmEnabled()) {
    try {
      const history = await recentHistory(buyerId, sellerId, 8);
      text = await llmReply(ctx, String(content || ''), history.slice(0, -1));
      source = 'llm';
    } catch (e) {
      console.warn('[ai-seller] LLM 通道失败，降级规则引擎：', e.message);
      text = '';
    }
  }
  if (!text) {
    text = ruleReply(intent, ctx);
    source = 'rule';
  }

  // 安全兜底 1：敏感词（违法违规内容）
  if (findSensitive(text)) {
    console.warn('[ai-seller] 生成内容命中敏感词，已替换安全话术');
    text = SAFE_REPLY.sensitive;
    source = 'safe';
  }

  // 安全兜底 2：商务边界（价格承诺 / 退款赔付 / 站外交易）
  const guarded = guardReply(text);
  if (guarded.blocked) {
    console.warn(`[ai-seller] 生成内容越界（${guarded.blocked}），已替换为合规话术`);
    text = guarded.text;
    source = 'safe';
  }

  return { content: text.slice(0, MAX_REPLY_LEN), intent, scope, source, confidence };
}

/** 模拟人类「正在输入」的随机延迟 */
function replyDelay() {
  return REPLY_DELAY_MIN + Math.floor(Math.random() * (REPLY_DELAY_MAX - REPLY_DELAY_MIN));
}

/** 记冷却时间戳 */
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
