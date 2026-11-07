# 校园二手优选（简换）· 项目上下文

供 AI 助手在打开本仓库时快速建立上下文。人读的说明见 `README.md`，运维细节见 `docs/RUNBOOK.md`。

## 项目定位

本科毕业设计：基于物品协同过滤（Item-based CF）的校园二手交易平台。
技术栈为**免构建**方案，改完代码刷新浏览器即可看到效果，没有 webpack/vite 打包环节。

| 层 | 技术 | 位置 |
|---|---|---|
| 前端 | Vue 3（全局构建版）+ Element Plus，自实现 hash 路由 | `frontend/` |
| 后端 | Node.js 22 + Express 4 + mysql2/promise | `backend/src/` |
| 数据库 | MySQL 8，13 张表 | `backend/sql/schema.sql` |
| 演示版 | 同上前端 + 浏览器内 mock，不连后端 | `demo/` |
| 部署 | RHEL 9 裸机（systemd + Nginx）或 Docker Compose | `deploy/` |

> **项目根目录没有 `package.json`，这是设计如此，不是遗漏。** 后端依赖只在 `backend/package.json`，前端免构建无依赖。在根目录执行 `npm install` 不会安装任何东西，请 `cd backend` 再装。

## 目录结构

```
backend/
  src/app.js            入口：挂载 11 个路由、/metrics、错误兜底
  src/routes/           按领域拆分的路由（auth/user/product/cart/order/message/...）
  src/middleware/       auth.js（JWT 验签 + 账号状态校验 + TTL 缓存 + optionalAuth）
  src/utils/            sensitive.js（敏感词）、login-guard.js（登录限流）
  src/services/         ai-seller.js（AI 卖家自动回复）
  src/data/             sensitive-words.txt 词库
  sql/                  schema.sql + 幂等迁移脚本
frontend/
  index.html            入口，资源用 ?v= 版本号破缓存
  app.js                全部视图与逻辑（单文件，约 1800 行；商品图片上传用 multer 写在 routes/product.js 里）
  serve.cjs             本地零依赖静态服务器（8080，反代 /api 到 3001）
  vendor/               内置 vue / element-plus / axios，不依赖 CDN
demo/                   公网演示版，与 frontend 是两套代码，改功能要同步两处
deploy/                 安装/更新脚本、Nginx、systemd、Docker、自检脚本
docs/                   RUNBOOK 运维手册 + incident 故障复盘
ops/monitor/            指标采集、告警判定、SMTP 通知
```

## 常用命令

```bash
# 本地一键启动（MySQL + 后端 3001 + 前端 8080），Windows
start-campus-mall.bat

# 只起后端（需 MySQL 已运行）
cd backend && node src/app.js

# 只起前端（代理 /api 到 3001）
cd frontend && node serve.cjs

# 部署到 Linux 服务器（首次装机 / 后续更新）
sudo bash deploy/scripts/install-rhel.sh
sudo bash deploy/scripts/update.sh

# 部署配置一致性自检（30 项断言，改完部署物料必跑）
python deploy/scripts/check-deploy.py

# 回归测试
bash output/qa_order_test.sh          # 订单状态机 24 项（位于工作区 output/，不在仓库内）
```

## 代码约定

- **前端免构建**：`index.html` 直接引 `app.js`，没有模块打包。新增页面 = 在 `app.js` 里加一个 `defineComponent` + 在路由表登记 + 顶栏加入口。
- **两套前端并存**：`frontend/` 连真实 API，`demo/` 走浏览器内 mock（入口判断 `window.__DEMO__`）。任何面向用户的改动**两边都要改**，否则公网演示版会落后。
- **改完前端必须升版本号**：`index.html` 里 `app.js?v=YYYYMMDDx`。Nginx 对 js/css 是强缓存，不升版本用户永远拿到旧文件。
- **敏感词过滤在服务端强制**：商品发布/编辑、私信发送、昵称修改三处都要过 `sensitive.js`，不能只在前端拦。
- **管理员是独立身份**：登录后台会清空普通用户 token，管理端视图由 `ADMIN_VIEWS` 白名单守卫。

## 容易踩的坑

1. **模板属性结尾引号丢失会导致整页白屏**，而 `node --check` 查不出来（Vue 报 `Attribute name cannot contain U+0022`）。批量改模板后要跑模板自检（脚本在工作区 `output/tpl-check.js`，不在仓库内）。
2. **`call()` 请求层必须把 `params` 交给 axios**。GET 时 axios 忽略 body，参数要写进 `cfg.params`，否则分类/搜索/分页会静默失效（不报错，只是没数据）。
3. **mysql2 判空**：`query()` 对 SELECT 返回行数组，整体判空用 `.length`；解构出的单行对象用 `if (!row)`。对对象取 `.length` 恒为 `undefined`，曾导致发货接口恒拒绝。
4. **`update.sh` 必须在源码目录执行**，不能在部署目录里跑（`SRC == DST` 会先删源码再复制失败）。
5. **Express 4 不捕获 async 异常**，已靠 `express-async-errors` 兜底，新增路由不要自己写 try/catch 再吞掉错误。
6. **Nginx 静态强缓存**：`/api/`、`/uploads/`、`/demo/` 必须用 `location ^~`，否则正则 location 会抢走。

## 数据库

13 张表：`user` `admin` `category` `product` `product_image` `address` `cart` `order` `order_item` `interaction` `message` `notice` `search_log`。

改动表结构后：更新 `backend/sql/schema.sql` → 重新生成 `deploy/mysql/init.sql` → 补一个幂等迁移脚本（参考 `backend/sql/migrate-ai-seller.js`）。

协同过滤行为权重：浏览 1 / 收藏 3 / 加购 4 / 购买 5，加权余弦算相似度，冷启动回落同类目热门。

## 不要做的事

- 不要把 `backend/.env`、`deploy/env/api.env` 提交或读出内容（含真实数据库口令与 JWT 密钥）。
- 不要直接改 `deploy/mysql/init.sql`，它是 `schema.sql` 的生成产物。
- 不要在 `frontend/`、`demo/` 下留 `_` 开头的自检脚本，部署脚本会删除它们（`update.sh` 已自动排除）。
- 不要用 `rm -rf` 清理 `backend/uploads/`，那是用户上传的商品图片。
