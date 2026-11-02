const express = require('express');
const router = express.Router();
const { query } = require('../db');
const { auth } = require('../middleware/auth');
const { sensitiveError } = require('../utils/sensitive');
const aiSeller = require('../services/ai-seller');

/**
 * AI 自动回复编排：判断这次「买家→卖家」的消息是否应由 AI 代答。
 * 触发条件（全部满足才会挂起一条待回复）：
 *   1. 收件人 seller_mode = 'auto'（该卖家开启了 AI 自动回复）
 *   2. 买卖双方不是同一账号（禁止自聊）
 *   3. 同一会话距上次 AI 回复已超过冷却时间（防刷屏）
 *   4. 同一会话当日 AI 回复未达上限
 * 返回 { pending, isAuto, reason }，pending=true 时前端进入「AI 正在输入」等待态。
 */
async function scheduleAiReply({ buyerId, sellerId, content, productId }) {
  if (buyerId === sellerId) return { pending: false, isAuto: false, reason: 'self' };

  const isAuto = await aiSeller.isAutoSeller(sellerId);
  if (!isAuto) return { pending: false, isAuto: false, reason: 'manual' };

  if (aiSeller.cooldownLeft(buyerId, sellerId) > 0) {
    return { pending: false, isAuto: true, reason: 'cooldown' };
  }
  const sentToday = await aiSeller.dailyCount(buyerId, sellerId);
  if (sentToday >= aiSeller.DAILY_PAIR_LIMIT) {
    return { pending: false, isAuto: true, reason: 'daily_limit' };
  }

  aiSeller.markReplied(buyerId, sellerId);
  // 异步生成 + 落库：不阻塞发送响应，延迟若干毫秒模拟真人「正在输入」
  setTimeout(async () => {
    try {
      const r = await aiSeller.generateReply({ sellerId, buyerId, content, productId });
      await query(
        'INSERT INTO message(from_id,to_id,content,sender_type,product_id) VALUES(?,?,?,1,?)',
        [sellerId, buyerId, r.content, productId]
      );
      console.log(
        `[ai-seller] 卖家#${sellerId} → 买家#${buyerId} 自动回复` +
        `（意图=${r.intent} 问题域=${r.scope} 引擎=${r.source} 置信度=${r.confidence}）：${r.content}`
      );
    } catch (e) {
      console.error('[ai-seller] 自动回复失败：', e.message);
    }
  }, aiSeller.replyDelay());

  return { pending: true, isAuto: true, reason: '' };
}

// 发送私信（若收件人是 AI 卖家，将自动触发一条 AI 回复）
router.post('/send', auth, async (req, res) => {
  const { to_id, content, product_id } = req.body;
  // 注意 to_id=0 是合法值（回复平台管理员），不能用 !to_id 判断，
  // 缺失/null/空串才是真的没填。
  if (to_id === undefined || to_id === null || to_id === '') {
    return res.status(400).json({ code: 400, msg: '收件人和内容必填' });
  }
  if (!content) return res.status(400).json({ code: 400, msg: '收件人和内容必填' });
  const se = sensitiveError(content, '私信内容');
  if (se) return res.status(400).json({ code: 400, msg: se });

  const toId = Number(to_id);
  const pid = Number(product_id) || 0;
  if (!Number.isFinite(toId) || toId < 0) {
    return res.status(400).json({ code: 400, msg: '收件人不合法' });
  }

  // 收件人必须是真实存在且未被禁用的用户。
  // 例外：to_id=0 是「回复平台管理员」，管理员不在 user 表里，放行。
  if (toId !== 0) {
    const targets = await query('SELECT id, status FROM `user` WHERE id=?', [toId]);
    if (!targets.length) {
      return res.status(404).json({ code: 404, msg: '收件人不存在' });
    }
    if (Number(targets[0].status) === 0) {
      return res.status(403).json({ code: 403, msg: '对方账号已被禁用，暂时无法接收私信' });
    }
  }

  await query(
    'INSERT INTO message(from_id,to_id,content,sender_type,product_id) VALUES(?,?,?,0,?)',
    [req.user.id, toId, content, pid]
  );

  // 只有「用户 → 用户」才可能触发 AI 卖家自动回复；回复平台管理员不参与该流程
  let ai = { pending: false, isAuto: false, reason: '' };
  if (toId !== 0) {
    try {
      ai = await scheduleAiReply({ buyerId: req.user.id, sellerId: toId, content, productId: pid });
    } catch (e) {
      console.error('[ai-seller] 触发判定失败：', e.message);
    }
  }

  res.json({
    code: 0,
    msg: '发送成功',
    ai_pending: ai.pending,      // 前端据此显示「AI 正在输入…」并轮询
    ai_seller: ai.isAuto,        // 对端是否为 AI 卖家
    ai_reason: ai.reason || '',  // cooldown / daily_limit / manual / self
  });
});

// 与某人的对话列表（附带对端信息，便于前端显示 AI 标识）
router.get('/talk/:userId', auth, async (req, res) => {
  const uid = req.user.id, oid = Number(req.params.userId);
  const rows = await query(
    'SELECT * FROM message WHERE (from_id=? AND to_id=?) OR (from_id=? AND to_id=?) ORDER BY created_at ASC, id ASC',
    [uid, oid, oid, uid]
  );
  const peers = await query(
    'SELECT id, nickname, avatar, seller_mode FROM `user` WHERE id=?',
    [oid]
  );
  // oid=0 表示「平台管理员」会话：管理员不在 user 表里，单独造一个对端信息给前端
  let peer;
  if (oid === 0) {
    peer = { id: 0, nickname: '平台管理员', avatar: '', seller_mode: 'manual' };
  } else {
    peer = peers.length ? peers[0] : null;
  }
  res.json({
    code: 0,
    data: rows,
    peer: peer
      ? { id: peer.id, nickname: peer.nickname, avatar: peer.avatar, seller_mode: peer.seller_mode }
      : null,
    ai_seller: !!(peer && peer.seller_mode === 'auto'),
  });
});

// 我的会话列表（按最近联系人聚合，附带该会话的未读条数）
// 未读口径：to_id = 当前用户（即「我是接收方」）且 is_read = 0
// 兼容管理员会话：管理员发出的消息 from_id=0，user 表里没有 id=0 的行，
// 所以这里用 LEFT JOIN，并把它显示成「平台管理员」。
router.get('/contacts', auth, async (req, res) => {
  const uid = req.user.id;
  const rows = await query(
    `SELECT c.partner_id AS contact_id,
            COALESCE(u.nickname, '平台管理员') AS nickname,
            u.avatar,
            COALESCE(u.seller_mode, 'manual') AS seller_mode,
            (c.partner_id = 0) AS is_admin,
            (SELECT content FROM message m2
               WHERE (m2.from_id=? AND m2.to_id=c.partner_id)
                  OR (m2.from_id=c.partner_id AND m2.to_id=?)
               ORDER BY m2.created_at DESC, m2.id DESC LIMIT 1) AS last_msg,
            (SELECT created_at FROM message m3
               WHERE (m3.from_id=? AND m3.to_id=c.partner_id)
                  OR (m3.from_id=c.partner_id AND m3.to_id=?)
               ORDER BY m3.created_at DESC, m3.id DESC LIMIT 1) AS last_time,
            (SELECT COUNT(*) FROM message m4
               WHERE m4.to_id=? AND m4.from_id=c.partner_id AND m4.is_read=0) AS unread
     FROM (SELECT DISTINCT CASE WHEN m.from_id=? THEN m.to_id ELSE m.from_id END AS partner_id
           FROM message m WHERE m.from_id=? OR m.to_id=?) c
     LEFT JOIN user u ON u.id = c.partner_id
     ORDER BY last_time DESC`,
    [uid, uid, uid, uid, uid, uid, uid, uid]
  );
  res.json({ code: 0, data: rows });
});

/**
 * 标记已读（只由「接收方」的打开会话动作触发）
 * -----------------------------------------------------------------
 * 已读语义：一条消息的 is_read 只表示「收件人是否已查看」。
 * 因此这里固定写成 `to_id = 当前用户`：
 *   - 接收方打开会话 → 命中自己收到且未读的行，置为已读；
 *   - 发送方打开会话 → 他发出的消息 to_id 是对方，条件不成立，
 *     一行都不会被更新，天然不会出现「自己看一遍就变已读」。
 * 前端仅在会话中存在「发给我的未读消息」时才调用本接口。
 */
router.put('/read/:fromId', auth, async (req, res) => {
  const raw = req.params.fromId;
  const peerId = Number(raw);
  // 0 是合法值：表示「平台管理员」会话（管理员不在 user 表里，from_id 固定为 0）
  if (raw === '' || !Number.isFinite(peerId) || peerId < 0) {
    return res.status(400).json({ code: 400, msg: '会话对象不合法' });
  }
  if (peerId === req.user.id) return res.json({ code: 0, msg: 'self', data: { updated: 0 } });

  const r = await query(
    'UPDATE message SET is_read=1 WHERE to_id=? AND from_id=? AND is_read=0',
    [req.user.id, peerId]
  );
  res.json({ code: 0, msg: 'ok', data: { updated: (r && r.affectedRows) || 0 } });
});

// 查询某用户是否为 AI 卖家（商品详情页 / 会话头部显示用）
router.get('/seller-mode/:userId', auth, async (req, res) => {
  const rows = await query('SELECT id, nickname, seller_mode FROM `user` WHERE id=?', [Number(req.params.userId)]);
  if (!rows.length) return res.status(404).json({ code: 404, msg: '用户不存在' });
  res.json({
    code: 0,
    data: {
      id: rows[0].id,
      nickname: rows[0].nickname,
      seller_mode: rows[0].seller_mode,
      ai_seller: rows[0].seller_mode === 'auto',
    },
  });
});

module.exports = router;
