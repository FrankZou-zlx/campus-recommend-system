// 幂等迁移：为 product 表补 title_pinyin / title_initials 两列，并为存量商品回填拼音
// 通过 update.sh 在自动部署时调用（需 pinyin-pro 已安装）
const { query } = require('../src/db');
const { pinyin } = require('pinyin-pro');

function toPinyin(title) {
  const t = String(title || '');
  const full = pinyin(t, { toneType: 'none', type: 'array' }).join('').toLowerCase();
  const init = pinyin(t, { pattern: 'first', toneType: 'none', type: 'array' }).join('').toLowerCase();
  return { full, init };
}

async function colExists(name) {
  const rows = await query(
    "SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product' AND COLUMN_NAME = ?",
    [name]
  );
  return rows.length > 0;
}

(async () => {
  try {
    if (!(await colExists('title_pinyin'))) {
      await query("ALTER TABLE product ADD COLUMN title_pinyin VARCHAR(255) NOT NULL DEFAULT '' COMMENT '标题全拼(小写)，用于拼音搜索'");
      console.log('[migrate] 新增列 title_pinyin');
    }
    if (!(await colExists('title_initials'))) {
      await query("ALTER TABLE product ADD COLUMN title_initials VARCHAR(60) NOT NULL DEFAULT '' COMMENT '标题拼音首字母(小写)，用于首字母搜索'");
      console.log('[migrate] 新增列 title_initials');
    }
    const rows = await query("SELECT id, title FROM product WHERE title_pinyin = '' OR title_pinyin IS NULL");
    let n = 0;
    for (const r of rows) {
      const py = toPinyin(r.title);
      await query('UPDATE product SET title_pinyin = ?, title_initials = ? WHERE id = ?', [py.full, py.init, r.id]);
      n++;
    }
    console.log(`[migrate] 回填拼音完成，共 ${n} 条`);
    process.exit(0);
  } catch (e) {
    console.error('[migrate] 失败:', e.message);
    process.exit(1);
  }
})();
