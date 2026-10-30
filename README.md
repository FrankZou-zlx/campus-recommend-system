# 校园优选 · 基于协同过滤算法的校园二手交易平台

> Vue3 + Express + MySQL 全栈实现，覆盖「发布 → 下单 → 支付 → 发货 → 确认收货」完整交易闭环。
> 在 RHEL 9.3 实机上以 9 步幂等脚本完成部署，systemd 托管、Nginx 反向代理、Prometheus 指标与邮件告警全链路打通。
> 全程零成本：不依赖任何付费 API 与商业云服务。

| 系统能力（业务侧） | 运维与支持（工程侧） |
| --- | --- |
| **11** 个功能模块 / **53** 个 REST 接口 / **13** 张数据表 | **9 步幂等部署**脚本，RHEL 9.3 实机跑通，重复执行不破坏已有数据 |
| 买卖同账号，卖家侧独立「我的出售」视图 | 增量更新脚本 + `SRC==DST` 路径护栏，防止在部署目录内执行导致源码被删 |
| 订单 5 态状态机：待付款 / 已付款 / 已发货 / 已完成 / 已取消 | systemd 服务托管、Nginx 静态托管与 `/api` 反向代理、SELinux 上下文配置 |
| Item-based 协同过滤：行为加权 1/3/4/5、加权余弦、类目兴趣 ×0.4、冷启动三级兜底 | Prometheus 指标采集 + 邮件告警闭环（firing / resolved 状态机，SMTP 协议自实现） |
| 站内私信 + AI 卖家自动回复（零成本规则引擎，可切换 LLM） | 服务端强制内容审核，商品发布 / 编辑 / 私信 / 昵称 4 个入口，不依赖前端拦截 |
| 管理员与普通用户身份完全隔离：独立表、独立登录入口、前端路由守卫 | 启动即校验环境变量，口令与密钥缺失直接拒绝启动，不设源码内默认值 |

> 下文依次为：技术栈 → 本地运行 → 功能一览 → 推荐算法 → 上云 → Linux 部署 → **运维与故障复盘** → 目录结构。

## 一、技术栈
- 前端：Vue3 + Element Plus + Axios，免构建方案（依赖内置在 `frontend/vendor/`，用自带的零依赖服务器 `serve.cjs` 托管，不需要 `npm install`）
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

**后续更新代码**：不要再重跑 `install-rhel.sh`。用 Git 推送即自动部署（推荐，见 **[GIT-WORKFLOW.md](./GIT-WORKFLOW.md)**），
或手动跑增量更新脚本：

```bash
sudo bash deploy/scripts/update.sh            # 同步代码 + 重载 Nginx + 重启后端，不碰数据库
sudo bash deploy/scripts/update.sh --schema   # 这次动了表结构
sudo bash deploy/scripts/update.sh --reseed   # 重新灌演示数据（会清空商品/订单/行为）
```

一次性搭建自建 Git 仓库与自动部署：

```bash
sudo bash deploy/scripts/setup-git.sh         # 服务器上执行一次
```

## 七、运维与故障复盘

这套系统不只是"能跑起来"，还留下了可查的运维痕迹：

| 材料 | 位置 | 内容 |
| --- | --- | --- |
| 运维手册 | [`docs/RUNBOOK.md`](docs/RUNBOOK.md) | 常用命令、发布与回滚、备份恢复、告警处置对照表、常见故障速查、值班交接清单 |
| 故障复盘 | [`docs/incident/`](docs/incident/) | 5 起真实故障的现象、排查过程、根因、修复与预防 |
| 一键巡检 | [`deploy/scripts/healthcheck.sh`](deploy/scripts/healthcheck.sh) | 检查磁盘/内存/负载/服务/Nginx/数据库/健康端点/上传目录/备份新鲜度，输出 PASS/WARN/FAIL，可挂 cron |
| 巡检实录 | [`docs/ops/healthcheck-20261030.txt`](docs/ops/healthcheck-20261030.txt) | 真机执行原始输出，15 项全 PASS、退出码 0 |
| 监控组件 | [`ops/monitor/`](ops/monitor/) | 零依赖指标采集 + 告警状态机 + SMTP 通知，不依赖任何付费服务 |

真机跑通（2026-10-30，RHEL 9.3 虚拟机，`sudo bash deploy/scripts/healthcheck.sh`）：

```
结果：FAIL 0 项 / WARN 0 项
```

定时任务已挂到 root crontab：每天 03:10 备份数据库（`--no-tablespaces` + 解压/表数/收尾标记三重自检，残缺即删并失败退出），每天 08:00 静默巡检（`--quiet` 只在 WARN/FAIL 时输出，便于接告警）。

5 起故障里，3 起属于「系统不报错但功能不对」：

| 编号 | 故障 | 根因 |
| --- | --- | --- |
| INC-001 | 部署脚本在部署目录执行，源码被删、站点 500 | `SRC==DST` 时先 `rm -rf` 再 `cp`，自己删了自己 |
| INC-002 | 前端改动"永远不生效" | 入口 HTML 被强缓存 7 天，资源清单指向旧文件 |
| INC-003 | 卖家发货接口恒失败 | 单行结果用 `!row.length` 判空，对象无 `length`，条件恒真 |
| INC-004 | 告警邮件一封都发不出 | 465 隐式 SSL 分支漏发 `EHLO`，`AUTH` 被 503 拒绝 |
| INC-005 | 商品显示「未分类」 | 删分类不查引用 + 自增计数未重置，留下悬空 `category_id` |

## 八、目录结构
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
├── docs/
│   ├── RUNBOOK.md           # ★ 运维手册
│   └── incident/            # ★ 5 份故障复盘
├── ops/monitor/             # ★ 指标采集 / 告警判定 / SMTP 通知
├── docker-compose.yml       # 方式 A：一键部署编排（MySQL + API + Nginx）
├── .env.example             # 方式 A 的环境变量模板
├── LINUX-DEPLOY.md          # Linux 部署细节（RHEL 系）
└── deploy/                  # 部署物料
    ├── docker/              #   Dockerfile.backend / Dockerfile.frontend / nginx-docker.conf
    ├── mysql/init.sql       #   容器首次启动自动建库建表（由 schema.sql 生成）
    ├── nginx/campus-mall.conf      # 裸机 Nginx 站点 + 反向代理
    ├── systemd/campus-mall-api.service  # 裸机后端服务单元
    ├── env/api.env.example  #   裸机环境变量模板（/etc/campus-mall/api.env）
    └── scripts/             #   install-rhel.sh / update.sh / healthcheck.sh / backup-db.sh / check-deploy.py
```
