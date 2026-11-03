/**
 * 图片真实性校验
 * ---------------------------------------------------------------------------
 * 只看扩展名和 Content-Type 不够 —— 这两个值都由客户端提交，可以随意伪造。
 * 把一段 HTML 或 SVG 改名成 x.png 上传，落在同源的 /uploads 目录下，
 * 浏览器打开时仍可能按脚本执行，从而读走 localStorage 里的登录令牌。
 *
 * 这里读取文件头部的「魔数」判断真实格式：不是真正的位图一律拒绝。
 * 只覆盖本项目允许的四种格式，与上传处的白名单保持一致。
 */
const fs = require('fs');

const SIGNATURES = [
  // JPEG: FF D8 FF
  { name: 'jpg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  {
    name: 'png',
    test: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
      b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a,
  },
  // GIF: GIF87a / GIF89a
  { name: 'gif', test: (b) => b.slice(0, 4).toString('ascii') === 'GIF8' },
  // WEBP: RIFF....WEBP
  {
    name: 'webp',
    test: (b) => b.slice(0, 4).toString('ascii') === 'RIFF' && b.slice(8, 12).toString('ascii') === 'WEBP',
  },
];

/**
 * 读取文件头部字节。
 * 文件不存在或不可读时返回空 Buffer，交给调用方判定为「不是图片」。
 */
function readHead(filePath, size = 12) {
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(size);
    const read = fs.readSync(fd, buffer, 0, size, 0);
    return buffer.slice(0, read);
  } catch (e) {
    return Buffer.alloc(0);
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch (e) { /* 关闭失败不影响判定 */ }
    }
  }
}

/** 判断文件是否是我们允许的真实图片格式 */
function isRealImage(filePath) {
  const head = readHead(filePath);
  if (!head.length) return false;
  return SIGNATURES.some((signature) => signature.test(head));
}

/** 删除校验未通过的文件，避免在 uploads 目录里留下垃圾 */
function removeQuietly(filePath) {
  if (!filePath) return;
  try { fs.unlinkSync(filePath); } catch (e) { /* 已经不在了就算了 */ }
}

module.exports = { isRealImage, removeQuietly };
