// 幂等迁移：为 AI 自动回复（auto 卖家）补齐数据结构
//   1. user.seller_mode       —— 卖家客服模式 manual(人工) / auto(AI 自动回复)
//   2. message.sender_type    —— 区分真人消息(0) 与 AI 自动回复(1)
//   3. message.product_id     —— 会话关联商品，为 AI 回复提供商品上下文
//   4. idx_pair_time 索引     —— 会话按时间取上下文更快
//   5. 演示数据：把「在售商品最多的前 3 个卖家」设为 auto，保证演示时任意商品都能触发 AI
// 由 update.sh 在自动部署时调用；脚本自身做存在性检查，可反复安全执行。
const { query } = require('../src/db');

async function colExists(table, name) {
  const rows = await query(
    "SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?",
    [table, name]
  );
  return rows.length > 0;
}

async function idxExists(table, name) {
  const rows = await query(
    "SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?",
    [table, name]
  );
  return rows.length > 0;
}

(async () => {
  try {
    // --- 1. user.seller_mode ---
    if (!(await colExists('user', 'seller_mode'))) {
      await query(
        "ALTER TABLE `user` ADD COLUMN `seller_mode` VARCHAR(16) NOT NULL DEFAULT 'manual' " +
        "COMMENT '卖家客服模式 manual=人工 auto=AI自动回复'"
      );
      console.log('[migrate] 新增列 user.seller_mode');
    } else {
      console.log('[migrate] user.seller_mode 已存在，跳过');
    }

    // --- 2. message.sender_type ---
    if (!(await colExists('message', 'sender_type'))) {
      await query(
        "ALTER TABLE `message` ADD COLUMN `sender_type` TINYINT NOT NULL DEFAULT 0 " +
        "COMMENT '0=真人 1=AI自动回复'"
      );
      console.log('[migrate] 新增列 message.sender_type');
    } else {
      console.log('[migrate] message.sender_type 已存在，跳过');
    }

    // --- 3. message.product_id ---
    if (!(await colExists('message', 'product_id'))) {
      await query(
        "ALTER TABLE `message` ADD COLUMN `product_id` INT UNSIGNED NOT NULL DEFAULT 0 " +
        "COMMENT '会话关联商品(可选)，为AI回复提供上下文'"
      );
      console.log('[migrate] 新增列 message.product_id');
    } else {
      console.log('[migrate] message.product_id 已存在，跳过');
    }

    // --- 4. 索引 ---
    if (!(await idxExists('message', 'idx_pair_time'))) {
      await query('ALTER TABLE `message` ADD KEY `idx_pair_time` (`from_id`,`to_id`,`created_at`)');
      console.log('[migrate] 新增索引 message.idx_pair_time');
    } else {
      console.log('[migrate] message.idx_pair_time 已存在，跳过');
    }

    // --- 5. 演示数据：给「在售商品最多的卖家」开启 auto ---
    const sellers = await query(
      `SELECT p.seller_id AS id, COUNT(*) AS n
         FROM product p
        WHERE p.status = 1
        GROUP BY p.seller_id
        ORDER BY n DESC, p.seller_id ASC
        LIMIT 3`
    );
    if (sellers.length === 0) {
      console.log('[migrate] 无在售商品卖家，跳过 auto 演示账号设置');
    } else {
      const ids = sellers.map((s) => s.id);
      // 用 IN (...) 显式列出，避免子查询在 UPDATE 同表时的限制
      const ph = ids.map(() => '?').join(',');
      await query(`UPDATE \`user\` SET seller_mode = 'auto' WHERE id IN (${ph})`, ids);
      const names = await query(
        `SELECT id, nickname, (SELECT COUNT(*) FROM product p WHERE p.seller_id = u.id AND p.status = 1) AS n
           FROM \`user\` u WHERE u.id IN (${ph})`,
        ids
      );
      console.log('[migrate] 已设为 auto 的演示卖家：' +
        names.map((r) => `${r.nickname}(id=${r.id},在售${r.n}件)`).join('、'));
    }

    const stat = await query("SELECT COUNT(*) AS n FROM `user` WHERE seller_mode = 'auto'");
    console.log(`[migrate] 当前 auto 卖家总数：${stat[0].n}`);
    console.log('[migrate] AI 自动回复数据结构就绪');
    process.exit(0);
  } catch (e) {
    console.error('[migrate] 失败:', e.message);
    process.exit(1);
  }
})();
