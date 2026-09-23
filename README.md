# 校园优选 · 基于协同过滤算法的校园电商推荐网站

> 计算机专业毕业设计 Demo 工程
> 三大要素：数据库（MySQL）+ 网页设计（Vue3 + Element Plus）+ 代码开发（Node.js/Express）
> 全程本地零花费，可免费上云（前端 Vercel + 后端 Render + 数据库 TiDB Serverless）

## 一、技术栈
- 前端：Vue3 + Vite + Element Plus + Axios + Vue Router
- 后端：Node.js + Express + JWT + Multer
- 数据库：MySQL 8（本地）/ TiDB Serverless 免费 MySQL 兼容库（上云，代码零改动）
- 推荐算法：JS 自实现「基于物品的协同过滤（Item-based CF）」+ 冷启动兜底（热门/同类目），不调任何付费 API

## 二、本地运行步骤（零花费）

### 1. 准备数据库
- 已在本工作区初始化了一个隔离的本地 MySQL 8 实例（数据目录 `.mysql/data`），root 无密码，仅本地使用。
- 如需自行安装：下载 MySQL 8 社区版，建库 `campus_mall`（utf8mb4），并执行 `backend/sql/schema.sql`。

### 2. 后端
```bash
cd campus-mall/backend
npm install
cp .env.example .env   # 已提供 .env，按本机配置修改
npm run seed           # 灌入演示数据（120 用户 / 60 商品 / 1388 行为）
npm start              # 启动 API，默认 http://localhost:3001
```

### 3. 前端（免构建，零依赖，推荐在本机直接这样跑）
> 说明：本项目把 Vue3 / Element Plus / Axios 直接下载到了 `frontend/vendor/`，
> 用自带的零依赖服务器 `serve.cjs` 托管，**不需要 npm install、不需要联网装包**，
> 规避了 npm 缓存被拦截的环境限制。
```bash
cd campus-mall/frontend
node serve.cjs        # 零依赖静态服务器，默认 http://localhost:8080
```
浏览器打开 http://localhost:8080 即可看到完整网站（已内置 /api 代理到后端 3001）。

> 备选（需要能联网装包的环境才用）：用 Vite 开发
> ```bash
> npm install
> npm run dev          # 默认 http://localhost:5173
> ```

### 4. 演示账号
- 普通用户：`user001` ~ `user120`，密码统一 `123456`
- 后台管理员：`admin` / `admin123`

## 三、功能一览
- 用户：注册/登录、资料、收货地址、改密
- 商品：发布/编辑/下架、分类、搜索、图片上传、收藏
- 交易：购物车、订单（待付款→已付款→已完成/取消）
- 行为采集：浏览/收藏/加购/购买（喂给推荐算法）
- 推荐：**首页「猜你喜欢」个性化推荐位**（协同过滤，冷启动兜底）
- 沟通：站内私信议价
- 后台：用户/商品管理、公告、数据统计、行为数据查看

## 四、推荐算法说明（论文可单独成章）
1. 用 `interaction` 表（view=1 / favorite=3 / cart=4 / buy=5）构建「商品-用户」分值矩阵；
2. 计算目标用户交互过的商品与其它商品的余弦相似度；
3. 汇总候选商品得分、排除已交互项、取 TopN；
4. 数据稀疏/新用户时退回「同类目热门 + 全局热门」混合推荐（冷启动处理）。

## 五、免费上云（可选，零花费，可真上线）
架构：**前端 Vercel（静态）＋ 后端 Render（Node 服务）＋ 数据库 TiDB Serverless（免费 MySQL 兼容云库）**。
- 前端：`frontend/` 部署到 Vercel，`buildCommand` 留空、`outputDirectory` 为 `.`，由 `frontend/vercel.json` 把 `/api`、`/uploads` 反向代理到后端（同源、无跨域）。
- 后端：`backend/` 部署到 Render（free 计划），`render.yaml` 已配好；数据库连接信息等通过环境变量注入。
- 数据库：**选用 TiDB Serverless 而非 Supabase**——因为本项目是 MySQL 语法（schema.sql、`?` 占位符），TiDB 是 MySQL 协议兼容的免费云库，只需把 `DB_*` 环境变量指向它，**后端一行代码都不用改**，正好兑现「配置与代码解耦」。
- 详细逐步操作见 **[DEPLOY.md](./DEPLOY.md)**（建库 → 推 GitHub → 连 Vercel/Render → 填环境变量 → 灌种子数据 → 上线验收）。
- 本地演示完全不受影响：仍用 `start-campus-mall.bat` 一键起 MySQL+后端+前端。
- **想要一个好记、带自己名字的演示网址？** 见 **[CLOUDFLARE-PAGES.md](./CLOUDFLARE-PAGES.md)**：
  演示版是纯静态（算法跑在浏览器里，不需要后端），拖一个 zip 到 Cloudflare Pages 就能得到
  `https://<你起的名字>.pages.dev` 这样的地址（免费）。上传包已备好：`campus-mall-demo-pages.zip`。

## 六、部署到 Linux 服务器（Docker Compose / 裸机 systemd）

完整步骤、运维命令速查与故障排查见 **[LINUX-DEPLOY.md](./LINUX-DEPLOY.md)**（按 RHEL / CentOS / Rocky 编写，两种方式任选）：

**方式 A：Docker Compose（推荐，一条命令起全套）**
```bash
cp .env.example .env && vi .env        # 改掉里面的密码与 JWT 密钥
docker compose up -d                   # 起 MySQL + 后端 API + Nginx 前端
docker compose exec api node sql/seed.js   # 灌入协同过滤演示数据
```
数据库与商品图片分别落在数据卷 `db_data` / `uploads`，容器重建不丢数据。

**方式 B：裸机（Nginx + systemd + MySQL）**
```bash
sudo bash deploy/scripts/install-rhel.sh    # 装包→建库→systemd→Nginx→SELinux→firewalld 全自动
```
后端由 systemd 托管（开机自启 + 崩溃自动重启），Nginx 提供前端静态资源并把 `/api`、`/uploads` 反向代理到 3001 端口。

部署完成后：`http://服务器IP/` 正式站、`/demo/` 免后端演示版、`/api/health` 接口探活；
数据库定时备份用 `deploy/scripts/backup-db.sh`（配合 crontab），改完部署配置可用
`python3 deploy/scripts/check-deploy.py` 做一次一致性自检。

## 七、目录结构
```
campus-mall/
├── backend/
│   ├── sql/schema.sql       # 建表 SQL（13 张表）
│   ├── sql/seed.js          # 演示数据灌入脚本（120 用户/60 商品/1000+ 行为）
│   ├── src/
│   │   ├── app.js           # Express 入口（监听 3001）
│   │   ├── db.js            # 数据库连接池（读 DB_* 环境变量，与代码解耦）
│   │   ├── middleware/auth.js
│   │   ├── services/recommend.js   # 基于物品的协同过滤算法 + 冷启动兜底
│   │   └── routes/          # auth/user/category/product/cart/order/message/recommend/admin/notice/search
│   └── uploads/             # 商品图片（本地存储）
├── frontend/                # 免构建前端
│   ├── index.html           # 入口
│   ├── app.js               # 整个应用逻辑（vue3 createApp + Element Plus）
│   ├── serve.cjs            # 零依赖静态服务器 + /api 代理（端口 8080）
│   └── vendor/              # 已下载的 vue.global.js / element-plus.* / axios / 中文包
├── demo/                    # 公开演示版源码（浏览器内跑协同过滤，localStorage 持久化）
├── demo-dist/               # 演示版纯净部署目录（只含运行需要的文件）
├── docker-compose.yml       # 方式 A：一键部署编排（MySQL + API + Nginx）
├── .env.example             # 方式 A 的环境变量模板
├── LINUX-DEPLOY.md          # ★ Linux 部署与运维手册（RHEL 系）
└── deploy/                  # 部署物料
    ├── docker/              #   Dockerfile.backend / Dockerfile.frontend / nginx-docker.conf
    ├── mysql/init.sql       #   容器首次启动自动建库建表（由 schema.sql 生成）
    ├── nginx/campus-mall.conf      # 裸机 Nginx 站点 + 反向代理
    ├── systemd/campus-mall-api.service  # 裸机后端服务单元
    ├── env/api.env.example  #   裸机环境变量模板（/etc/campus-mall/api.env）
    └── scripts/             #   install-rhel.sh / backup-db.sh / gen-init-sql.js / check-deploy.py
```
