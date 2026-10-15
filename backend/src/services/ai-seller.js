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
 *   3) 安全兜底：两条通道的输出都会再过一遍敏感词过滤，命中则改用安全话术。
 *
 * 触发条件（由 routes/message.js 调用方把关）：
 *   - 收件人 seller_mode = 'auto'（该账号即「AI 卖家」）
 *   - 发送方与收件人不是同一人（禁止自聊递归）
 *   - 同一会话 AI 回复间隔 >= COOLDOWN_MS（防刷屏）
 *   - 同一会话每日 AI 回复条数 < DAILY_PAIR_LIMIT
 *   - AI 自己发出的消息不再触发（sender_type=1 不参与触发）
 *
 * 输入：{ sellerId, buyerId, content, productId }
 * 输出：{ content, intent, source: 'llm'|'rule'|'safe', confidence }
 */
const { query } = require('../db');
const { findSensitive } = require('../utils/sensitive');

// ---------------------------------------------------------------- 策略常量
const COOLDOWN_MS = 3000;             // 同一会话两次 AI 回复的最小间隔
const DAILY_PAIR_LIMIT = 50;          // 同一会话每日 AI 回复上限
const REPLY_DELAY_MIN = 600;          // 模拟「正在输入」的最短延迟
const REPLY_DELAY_MAX = 1400;         // 模拟「正在输入」的最长延迟
const MAX_REPLY_LEN = 300;            // 单条回复最大长度

// 进程内冷却记录：key = `${buyerId}:${sellerId}` -> 上次回复时间戳
const lastReplyAt = new Map();

// ---------------------------------------------------------------- 意图规则
// 数组顺序即优先级：砍价/询价最优先，问候类最后（避免「你好，能便宜点吗」被判成问候）
const INTENT_RULES = [
  { key: 'bargain',   label: '砍价',   kw: ['便宜', '少点', '少一', '优惠', '刀', '降价', '让点', '让点价', '能少', '最低', '贵了', '打折', '划算点', '实惠点'] },
  { key: 'price',     label: '询价',   kw: ['多少钱', '价格', '什么价', '几块', '几多', '报价', '售价', '多少出'] },
  { key: 'accessory', label: '配件',   kw: ['配件', '发票', '保修', '包装', '说明书', '原装', '数据线', '充电器'] },
  { key: 'stock',     label: '库存',   kw: ['还有吗', '还有货', '现货', '库存', '还有几个', '还有几件', '有没有货', '卖掉了吗', '出掉了吗', '还在吗', '在了吗'] },
  { key: 'condition', label: '成色',   kw: ['几成新', '成色', '新旧', '磨损', '划痕', '用了多久', '用了多长', '破损', '瑕疵', '磕碰', '故障', '好不好用'] },
  { key: 'delivery',  label: '配送',   kw: ['包邮', '快递', '发货', '邮寄', '顺丰', '运费', '寄过来', '送到', '送吗', '能寄'] },
  { key: 'location',  label: '面交',   kw: ['哪里', '在哪', '面交', '地点', '自提', '宿舍', '教学楼', '图书馆', '哪个校区', '怎么拿', '见面'] },
  { key: 'thanks',    label: '致谢',   kw: ['谢谢', '感谢', '多谢', '麻烦了', '收到', '好的', '好嘞', 'ok'] },
  { key: 'greeting',  label: '问候',   kw: ['你好', '您好', '在吗', '在么', '哈喽', 'hi', 'hello', '在不在', '打扰'] },
];

/**
 * 意图识别：返回首个命中的意图（规则顺序即优先级）
 * @returns {{intent:string,label:string,hit:string,confidence:number}}
 */
function detectIntent(text) {
  const t = String(text || '').toLowerCase().trim();
  for (const rule of INTENT_RULES) {
    const hit = rule.kw.find((k) => t.includes(k));
    if (hit) {
      const confidence = Math.min(0.95, 0.6 + hit.length * 0.08);
      return { intent: rule.key, label: rule.label, hit, confidence: Number(confidence.toFixed(2)) };
    }
  }
  return { intent: 'other', label: '其它', hit: '', confidence: 0.3 };
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

/** 砍价让价策略：小幅让价（约 5%），低价商品改为「送赠品/包邮」话术 */
function bargainPlan(price) {
  const p = Number(price) || 0;
  if (p <= 0) return { offer: null, gift: true };
  if (p < 20) return { offer: null, gift: true };          // 低价不让价，送东西
  const offer = Math.max(1, Math.round(p * 0.95));          // 约 5% 让价
  return { offer, gift: p >= 100 };                         // 高价再叠赠品
}

/** 商品称呼：优先用聚焦商品标题，否则用总称 */
function titleOf(ctx) {
  return ctx.focus ? ctx.focus.title : '这件东西';
}

// ---------------------------------------------------------------- 规则引擎
/**
 * 规则引擎：按意图挑选话术并填充商品信息
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
      if (!item) {
        return pick([
          '价格都好商量的～你说个心理价，合适的话我就出了。',
          '可以聊聊价，诚心要的话我给你让一点。',
        ]);
      }
      const { offer, gift } = bargainPlan(item.price);
      if (!offer) {
        return pick([
          `这个 ${price} 元本来就挺实惠啦，真想要的话我再送你点小配件，或者校内给你送过去～`,
          `${title} 就 ${price} 元，价格压得很低了，我再送你点东西当补贴吧～`,
        ]);
      }
      const tail = gift ? '，自提的话再送你个小配件' : '，校内自提这个价';
      return pick([
        `可以小刀～${title} 原价 ${price}，你诚心要的话 ${offer} 元给你${tail}。`,
        `价格还能聊，${offer} 元怎么样？${title} 我平时用得挺少的${gift ? '，再送你个小配件' : ''}。`,
        `这样吧，${offer} 元拿走${tail}，就当交个朋友～`,
      ]);
    }
    case 'price': {
      if (!item) {
        return pick([
          '你想问哪一件呀？我主页的在售商品都标了价，看中哪个我再说说细节。',
          '我这几件价格都不高，你说下具体是哪件，我给你报个实价。',
        ]);
      }
      const stockTail = stock > 1 ? `还有 ${stock} 件` : '就剩最后一件了';
      return pick([
        `${title} 是 ${price} 元，${stockTail}。`,
        `${title} 我标 ${price} 元，成色挺好，${stockTail}。`,
      ]);
    }
    case 'stock': {
      if (!item) {
        return pick(['还有的，你想要哪件？', '在的，随时可以出～']);
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
        '校内可以直接给你送过去，要寄快递的话这件我给你包邮～',
        '同城/校内我都能送，快递也可以，运费我出。',
      ]);
    }
    case 'location': {
      return pick([
        '我就在校内，宿舍、教学楼、图书馆都能约，看你哪个时间方便～',
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
          `你好～${title} 还在的，有什么想了解的？价格、成色、面交都能聊。`,
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
          `收到～你问的这个我记下了，${title} 还在售，${price ? `价格 ${price} 元，` : ''}有别的疑问也可以一起问我。`,
          `好的，${title} 目前还在，具体情况我可以再补充，你还想了解哪方面？`,
        ]);
      }
      return pick([
        '收到～你可以说下具体看中的商品，我给你详细说说。',
        '好的，有需要随时问我，价格什么的都好商量。',
      ]);
    }
  }
}

// ---------------------------------------------------------------- LLM 通道
function llmEnabled() {
  return !!(process.env.AI_CHAT_API_KEY && process.env.AI_CHAT_BASE_URL);
}

function buildSystemPrompt(ctx) {
  const list = ctx.items.slice(0, 10)
    .map((i) => `- ${i.title}：${yuan(i.price)} 元，库存 ${i.stock}${i.category_name ? '，类目 ' + i.category_name : ''}`)
    .join('\n');
  const focusLine = ctx.focus ? `买家正在询问的商品：${ctx.focus.title}（${yuan(ctx.focus.price)} 元）。` : '';
  return `你是校园二手交易平台的卖家「${ctx.seller.nickname}」，正在与买家进行站内私信沟通。
你的在售商品：
${list || '（暂无在售商品）'}
${focusLine}
回复要求：
1. 口语化、亲切自然，像学生之间聊天，控制在 60 字以内；
2. 只能基于上面列出的在售商品作答，不要编造没有的商品；
3. 可以小幅让价，但不得低于原价的 90%；
4. 引导校内自提或平台内交易，不做平台外交易承诺；
5. 不输出任何违法违规、色情或敏感内容；
6. 直接输出回复正文，不要加引号、不要解释。`;
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
 * @returns {Promise<{content:string,intent:string,source:string,confidence:number}>}
 */
async function generateReply({ sellerId, buyerId, content, productId = 0 }) {
  const ctx = await loadContext(sellerId, productId);
  const { intent, confidence } = detectIntent(content);

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

  // 安全兜底：AI 生成内容同样过敏感词，命中则替换为安全话术
  if (findSensitive(text)) {
    console.warn('[ai-seller] 生成内容命中敏感词，已替换安全话术');
    text = '这个问题我稍后仔细回复你，你也可以先看看商品详情～';
    source = 'safe';
  }

  return { content: text.slice(0, MAX_REPLY_LEN), intent, source, confidence };
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
};
