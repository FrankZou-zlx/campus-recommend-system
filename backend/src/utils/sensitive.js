// 敏感词过滤：服务端强制校验，前端绕过无效
// 词库文件：backend/src/data/sensitive-words.txt（每行一个词，由运营/合规方维护）
// 匹配规则：大小写不敏感；空行/纯空白会被忽略（防止空串误杀全部文本）
const fs = require('fs');
const path = require('path');

let WORD_LIST = []; // 归一化后的词数组，按长度降序（优先命中更具体的长词）

function load() {
  const file = path.join(__dirname, '..', 'data', 'sensitive-words.txt');
  const raw = fs.readFileSync(file, 'utf8');
  const set = new Set();
  for (const line of raw.split(/\r?\n/)) {
    const w = line.trim();
    if (!w) continue; // 跳过空行/纯空白
    set.add(w.toLowerCase());
  }
  WORD_LIST = [...set].sort((a, b) => b.length - a.length);
}

load();

// 检测文本是否含违禁词，命中返回该词（小写），否则返回 null
function findSensitive(text) {
  if (!text) return null;
  const t = String(text).toLowerCase();
  for (const w of WORD_LIST) {
    if (t.includes(w)) return w;
  }
  return null;
}

// 业务侧便捷方法：返回错误提示（'' 表示通过）
function sensitiveError(text, fieldLabel = '内容') {
  const hit = findSensitive(text);
  if (hit) return `${fieldLabel}包含不允许的违禁词，请修改后重试`;
  return '';
}

module.exports = {
  findSensitive,
  sensitiveError,
  get count() { return WORD_LIST.length; }
};
