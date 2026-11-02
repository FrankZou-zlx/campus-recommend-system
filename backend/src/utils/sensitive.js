/**
 * 敏感词过滤工具
 * ---------------------------------------------------------------------------
 * 词库文件：backend/src/data/sensitive-words.txt，每行一个词，由运营/合规方维护。
 * 匹配规则：大小写不敏感；空行与纯空白行会被跳过，
 *           否则词库里一个空串会让「任何文本都命中」。
 * 用途：服务端强制校验，前端绕过无效。商品发布、商品编辑、私信、昵称修改都要过这一层。
 */
const fs = require('fs');
const path = require('path');

// 词表：按长度从长到短排序，保证「优先命中更具体的词」
let sensitiveWords = [];

/**
 * 启动时加载词库。文件不存在会直接抛错，让部署阶段就暴露问题，
 * 而不是等到用户发商品时才发现审核失效。
 */
function loadWordList() {
  const wordFile = path.join(__dirname, '..', 'data', 'sensitive-words.txt');
  const rawText = fs.readFileSync(wordFile, 'utf8');

  const uniqueWords = new Set();
  for (const line of rawText.split(/\r?\n/)) {
    const word = line.trim();
    if (!word) {
      continue;
    }
    uniqueWords.add(word.toLowerCase());
  }

  sensitiveWords = [...uniqueWords].sort((left, right) => right.length - left.length);
}

loadWordList();

/**
 * 检测文本里是否含违禁词。
 *
 * @param {string} text 待检测文本
 * @returns {string|null} 命中的词（小写），没有命中返回 null
 */
function findSensitive(text) {
  if (!text) {
    return null;
  }

  const lowerText = String(text).toLowerCase();
  for (const word of sensitiveWords) {
    if (lowerText.includes(word)) {
      return word;
    }
  }
  return null;
}

/**
 * 业务侧便捷方法：命中违禁词时返回给用户看的提示，通过时返回空串。
 *
 * @param {string} text 待检测文本
 * @param {string} fieldLabel 字段名，用于拼提示语，例如「商品标题」
 * @returns {string} 空串表示通过
 */
function sensitiveError(text, fieldLabel = '内容') {
  const hitWord = findSensitive(text);
  if (hitWord) {
    return `${fieldLabel}包含不允许的违禁词，请修改后重试`;
  }
  return '';
}

module.exports = {
  findSensitive,
  sensitiveError,
  get count() {
    return sensitiveWords.length;
  },
};
