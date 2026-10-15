// 幂等清理：自动下架历史验收脚本残留的测试商品
// 匹配规则刻意收窄到「E2E验收测试商品」前缀（仅自动验收脚本会生成该标题），
// 不影响真实用户商品。由 update.sh 在自动部署时调用。
const { query } = require('../src/db');

(async () => {
  try {
    const rows = await query(
      "SELECT id, title FROM product WHERE status = 1 AND title LIKE 'E2E验收测试商品%'"
    );
    if (!rows.length) {
      console.log('[cleanup] 无残留测试商品');
      process.exit(0);
    }
    for (const r of rows) {
      await query('UPDATE product SET status = 0 WHERE id = ?', [r.id]);
      console.log(`[cleanup] 已下架测试商品 #${r.id}《${r.title}》`);
    }
    console.log(`[cleanup] 共清理 ${rows.length} 条`);
    process.exit(0);
  } catch (e) {
    console.error('[cleanup] 失败:', e.message);
    process.exit(1);
  }
})();
