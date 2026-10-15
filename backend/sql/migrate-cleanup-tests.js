// 幂等清理：自动下架历史验收脚本残留的测试商品
// 匹配规则刻意收窄到「E2E验收测试商品」前缀（仅自动验收脚本会生成该标题），
// 不影响真实用户商品。由 update.sh 在自动部署时调用。
const { query } = require('../src/db');

(async () => {
  try {
    const rows = await query(
      "SELECT id, title FROM product WHERE status = 1 AND title LIKE 'E2E验收测试商品%'"
    );
    for (const r of rows) {
      await query('UPDATE product SET status = 0 WHERE id = ?', [r.id]);
      console.log(`[cleanup] 已下架测试商品 #${r.id}《${r.title}》`);
    }
    if (rows.length) console.log(`[cleanup] 共下架 ${rows.length} 条`);

    // 修复拼音搜索验收时留下的「占位描述」，换成正常商品文案
    const fix = await query(
      "SELECT id FROM product WHERE title = '保湿喷雾便携装' AND description = '测试拼音'"
    );
    for (const r of fix) {
      await query('UPDATE product SET description = ? WHERE id = ?',
        ['外出补水神器，小巧便携，随时喷一喷，全新未拆封，需要的同学私聊～', r.id]);
      console.log(`[cleanup] 已修复测试商品 #${r.id} 的商品描述`);
    }
    if (!rows.length && !fix.length) console.log('[cleanup] 无残留测试数据');
    process.exit(0);
  } catch (e) {
    console.error('[cleanup] 失败:', e.message);
    process.exit(1);
  }
})();
