/**
 * 模板体检：批量替换前端模板后必跑。
 *
 * 背景：用脚本批量替换 app.js 里的一整行标签时，很容易把某个属性的结尾引号一起吃掉，
 * 例如 `title="xxx" type="info"` 变成 `title="xxx type="info"` —— JS 语法仍然合法（node --check 通过！），
 * 但 Vue 模板编译会失败并抛出：
 *   [Vue warn] Template compilation error: Attribute name cannot contain U+0022 (")
 *   Uncaught InvalidCharacterError: Failed to execute 'setAttribute' ...
 * 结果就是【整页白屏】，而且 node --check 完全看不出来。
 *
 * 用法：node _tplcheck.js   （退出码非 0 表示有问题）
 * 更保险的做法：改完模板后用无头浏览器抓一次控制台（见 _selftest.html / SKILL.md）。
 */
const fs = require('fs');
const path = require('path');

const FILES = [
  path.join(__dirname, '..', 'frontend', 'app.js'),
  path.join(__dirname, 'app.js'),
];

let failed = 0;
for (const f of FILES) {
  if (!fs.existsSync(f)) { console.log('跳过（不存在）: ' + f); continue; }
  const lines = fs.readFileSync(f, 'utf8').split('\n');
  const bad = [];
  lines.forEach((ln, i) => {
    if (!/<[a-zA-Z]/.test(ln)) return;        // 只看含标签的行
    if (/^\s*(\/\/|\*)/.test(ln)) return;     // 跳过注释
    const q = (ln.match(/"/g) || []).length;
    if (q % 2 !== 0) bad.push({ n: i + 1, text: ln.trim().slice(0, 140) });
  });
  console.log((bad.length ? '⚠ ' : '✅ ') + path.relative(path.join(__dirname, '..'), f) + '  引号不配对的行 = ' + bad.length);
  bad.forEach((b) => console.log('   ' + b.n + ': ' + b.text));
  if (bad.length) failed++;
}
process.exit(failed ? 1 : 0);
