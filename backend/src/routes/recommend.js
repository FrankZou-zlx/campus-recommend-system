const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const { itemCF } = require('../services/recommend');

// 猜你喜欢（个性化推荐位）
// 登录用户：基于物品的协同过滤；不足时混合「同类目/全局热门」兜底
router.get('/for-you', auth, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 8;
    const list = await itemCF(req.user.id, limit);
    res.json({ code: 0, data: list });
  } catch (e) {
    res.status(500).json({ code: 500, msg: '推荐失败: ' + e.message });
  }
});

module.exports = router;
