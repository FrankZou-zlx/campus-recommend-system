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
        `（意图=${r.intent} 引擎=${r.source} 置信度=${r.confidence}）：${r.content}`
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
  if (!to_id || !content) return res.status(400).json({ code: 400, msg: '收件人和内容必填' });
  const se = sensitiveError(content, '私信内容');
  if (se) return res.status(400).json({ code: 400, msg: se });

  const toId = Number(to_id);
  const pid = Number(product_id) || 0;
  await query(
    'INSERT INTO message(from_id,to_id,content,sender_type,product_id) VALUES(?,?,?,0,?)',
    [req.user.id, toId, content, pid]
  );

  let ai = { pending: false, isAuto: false, reason: '' };
  try {
    ai = await scheduleAiReply({ buyerId: req.user.id, sellerId: toId, content, productId: pid });
  } catch (e) {
    console.error('[ai-seller] 触发判定失败：', e.message);
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
  const peer = peers.length ? peers[0] : null;
  res.json({
    code: 0,
    data: rows,
    peer: peer
      ? { id: peer.id, nickname: peer.nickname, avatar: peer.avatar, seller_mode: peer.seller_mode }
      : null,
    ai_seller: !!(peer && peer.seller_mode === 'auto'),
  });
});

// 我的会话列表（按最近联系人聚合）
router.get('/contacts', auth, async (req, res) => {
  const uid = req.user.id;
  const rows = await query(
    `SELECT c.partner_id AS contact_id, u.nickname, u.avatar, u.seller_mode,
            (SELECT content FROM message m2
               WHERE (m2.from_id=? AND m2.to_id=c.partner_id)
                  OR (m2.from_id=c.partner_id AND m2.to_id=?)
               ORDER BY m2.created_at DESC, m2.id DESC LIMIT 1) AS last_msg,
            (SELECT created_at FROM message m3
               WHERE (m3.from_id=? AND m3.to_id=c.partner_id)
                  OR (m3.from_id=c.partner_id AND m3.to_id=?)
               ORDER BY m3.created_at DESC, m3.id DESC LIMIT 1) AS last_time
     FROM (SELECT DISTINCT CASE WHEN m.from_id=? THEN m.to_id ELSE m.from_id END AS partner_id
           FROM message m WHERE m.from_id=? OR m.to_id=?) c
     JOIN user u ON u.id = c.partner_id
     ORDER BY last_time DESC`,
    [uid, uid, uid, uid, uid, uid, uid]
  );
  res.json({ code: 0, data: rows });
});

// 标记已读
router.put('/read/:fromId', auth, async (req, res) => {
  await query('UPDATE message SET is_read=1 WHERE to_id=? AND from_id=?', [req.user.id, req.params.fromId]);
  res.json({ code: 0, msg: 'ok' });
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
