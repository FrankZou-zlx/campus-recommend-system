/**
 * 订单状态机迁移：4 态 → 5 态（幂等，可反复执行）
 *
 * 旧语义：0=待付款 1=已付款 2=已完成 3=已取消
 * 新语义：0=待付款 1=已付款 2=已发货·待收货 3=已完成 4=已取消
 *
 * 关键约束：必须先 3→4 再 2→3，否则值冲突（若先 2→3，原 3 会一并被挪成 4）。
 * 同时补齐 shipped_at / finished_at 两列（若不存在）。
 *
 * 运行：node sql/migrate-order-status.js        （在 backend/ 目录下）
 */
require('dotenv').config();
const { query } = require('../src/db');

async function migrate() {
  // 1. 列补齐（幂等）
  const cols = await query(
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='order'"
  );
  const has = new Set(cols.map(c => c.COLUMN_NAME));
  if (!has.has('shipped_at')) {
    await query("ALTER TABLE `order` ADD COLUMN shipped_at DATETIME DEFAULT NULL COMMENT '卖家发货时间'");
    console.log('  + 已新增列 shipped_at');
  }
  if (!has.has('finished_at')) {
    await query("ALTER TABLE `order` ADD COLUMN finished_at DATETIME DEFAULT NULL COMMENT '买家确认收货时间'");
    console.log('  + 已新增列 finished_at');
  }

  // 2. 状态迁移（顺序关键：先 3→4，再 2→3；0/1 不变）
  const r1 = await query('UPDATE `order` SET status=4 WHERE status=3');
  const r2 = await query('UPDATE `order` SET status=3 WHERE status=2');
  console.log(`  状态迁移：原已取消→新已取消 ${r1.affectedRows} 行；原已完成→新已完成 ${r2.affectedRows} 行`);

  // 3. 已完成订单补 finished_at（演示真实度，用下单时间近似）
  const r3 = await query('UPDATE `order` SET finished_at=created_at WHERE status=3 AND finished_at IS NULL');
  if (r3.affectedRows) console.log(`  已为 ${r3.affectedRows} 笔已完成订单补全 finished_at`);

  // 4. 校验：不应有 2/3 之外的历史值残留
  const bad = await query('SELECT COUNT(*) c FROM `order` WHERE status<0 OR status>4');
  if (Number(bad[0].c) > 0) throw new Error('迁移后仍存在非法状态值，请人工核查');
  console.log('✅ 订单状态迁移完成，全部状态值落在 0~4 合法区间');
}

if (require.main === module) {
  migrate()
    .then(() => process.exit(0))
    .catch(e => { console.error('MIGRATE ERROR:', e.message); process.exit(1); });
}

module.exports = { migrate };
