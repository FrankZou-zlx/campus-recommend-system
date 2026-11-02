// 幂等迁移：为「管理员禁用用户」补齐数据结构
//   1. user.status   —— 1=正常 0=已禁用；禁用后禁止登录，已签发的 token 也会被中间件拦下
//   2. message.sender_type 的取值扩展 —— 2 表示「平台管理员」（from_id 固定为 0）
//      MySQL 的 TINYINT 不需要改类型，这里只把列注释更新成新口径，方便后人看懂
// 由 update.sh 在自动部署时调用；脚本自身做存在性检查，可反复安全执行。
const { query } = require('../src/db');

async function colExists(table, name) {
  const rows = await query(
    'SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
    [table, name]
  );
  return rows.length > 0;
}

(async () => {
  try {
    // --- 1. user.status ---
    if (!(await colExists('user', 'status'))) {
      await query(
        "ALTER TABLE `user` ADD COLUMN `status` TINYINT NOT NULL DEFAULT 1 " +
        "COMMENT '1=正常 0=已禁用（禁止登录与一切写操作）' AFTER `role`"
      );
      console.log('[migrate] 新增列 user.status');
    } else {
      console.log('[migrate] user.status 已存在，跳过');
    }

    // --- 2. 存量数据兜底：旧行若因手工改库变成 NULL，统一按「正常」处理 ---
    const fixed = await query('UPDATE `user` SET status = 1 WHERE status IS NULL');
    if (fixed && fixed.affectedRows) {
      console.log(`[migrate] 修正 ${fixed.affectedRows} 条 status 为空的用户记录`);
    }

    // --- 3. 刷新 message.sender_type 的列注释（取值从 2 种扩到 3 种）---
    if (await colExists('message', 'sender_type')) {
      await query(
        "ALTER TABLE `message` MODIFY COLUMN `sender_type` TINYINT NOT NULL DEFAULT 0 " +
        "COMMENT '0=真人 1=AI自动回复 2=平台管理员（from_id 固定为 0）'"
      );
      console.log('[migrate] 已更新 message.sender_type 列注释');
    }

    const stat = await query(
      'SELECT COUNT(*) AS total, SUM(status = 0) AS disabled FROM `user`'
    );
    const row = stat[0] || {};
    console.log(`[migrate] 用户总数 ${row.total || 0}，其中已禁用 ${row.disabled || 0}`);
    console.log('[migrate] 用户禁用数据结构就绪');
    process.exit(0);
  } catch (e) {
    console.error('[migrate] 失败:', e.message);
    process.exit(1);
  }
})();
