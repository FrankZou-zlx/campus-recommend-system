# 免费上云部署指南（零花费）

本指南把「校园二手优选」部署到免费云服务，让毕业设计可以**真在公网访问、答辩时实说「已上线」**。
整体架构：**前端 Vercel（静态）＋ 后端 Render（Node 服务）＋ 数据库 TiDB Serverless（MySQL 兼容免费库）**。

> 为什么用 TiDB 而不是 README 早期写的 Supabase？
> 因为本项目数据库是 **MySQL** 语法（schema.sql、`?` 占位符、AUTO_INCREMENT）。
> Supabase 是 **Postgres**，若用它得把建表语句和所有查询改写，改动大且难本地验证。
> TiDB Serverless 是**免费的 MySQL 协议兼容云数据库**，连接信息换成它的即可，**后端一行代码都不用改**，正好兑现「配置与代码解耦」的设计。

---

## 第 0 步：准备（需注册的免费账号）
| 服务 | 用途 | 注册 |
|------|------|------|
| GitHub | 托管代码，供 Vercel / Render 拉取 | github.com |
| Vercel | 托管前端静态站 | vercel.com（用 GitHub 登录） |
| Render | 托管后端 Node 服务 | render.com（用 GitHub 登录） |
| TiDB Serverless | 免费 MySQL 兼容云数据库 | pingcap.com 的 TiDB Cloud |

> 全部免费、无需绑卡（按免费额度使用即可）。

## 第 1 步：把代码推到 GitHub
```bash
cd campus-mall
git init
git add .
git commit -m "campus-mall 毕设：协同过滤推荐电商"
git branch -M main
git remote add origin https://github.com/<你的用户名>/campus-mall.git
git push -u origin main
```

## 第 2 步：建云数据库（TiDB Serverless）
1. 进入 TiDB Cloud → 新建 **Serverless** 集群 → 区域任选（靠近国内选 `aws-ap-southeast-1` 等）。
2. 建库：在控制台 SQL 里执行 `CREATE DATABASE campus_mall;`。
3. 导入数据：把 `backend/sql/schema.sql` 全量执行（建 12 张表）。
4. 获取连接串：控制台「Connect」→ 选择 `MySQL` 协议 → 记下
   `host`、`port`、`user`、`password`、`database=campus_mall`。
   （密码含特殊字符时建议 URL 编码。）

## 第 3 步：部署后端（Render）
1. Render 控制台 → **New → Web Service** → 连上面 GitHub 仓库。
2. 关键设置（Render 会读仓库里的 `render.yaml`，以下也可在面板确认）：
   - Root Directory：`backend`
   - Build Command：`npm install`
   - Start Command：`npm start`
   - Plan：**Free**
3. 在 Render 的 **Environment** 里填写变量（对应 `.env.example`）：
   - `NODE_ENV=production`
   - `DB_HOST` / `DB_PORT` / `DB_USER` / `DB_PASSWORD` = 第 2 步 TiDB 的连接信息
   - `DB_NAME=campus_mall`
   - `JWT_SECRET` = 任意随机长串
   - `CLIENT_ORIGIN` = 第 4 步拿到后的 Vercel 地址（可稍后补）
4. 部署完成后记下后端地址，形如 `https://campus-mall-backend.onrender.com`。

## 第 4 步：部署前端（Vercel）
1. Vercel 控制台 → **Add New → Project** → 连上面 GitHub 仓库。
2. 关键设置：
   - Root Directory：`frontend`
   - Framework Preset：**Other**
   - Build Command：**留空**
   - Output Directory：`.`
3. **必须改一处**：打开 `frontend/vercel.json`，把里面的占位地址
   `https://campus-mall-backend.onrender.com` 替换成第 3 步拿到的真实后端地址。
   （这样前端 `/api` 和 `/uploads` 会由 Vercel 反向代理到后端，同源、无跨域。）
4. Deploy。完成后得到前端地址，形如 `https://campus-mall.vercel.app`。
5. 回到 Render，把 `CLIENT_ORIGIN` 补成该 Vercel 地址（保险用）。

## 第 5 步：灌入演示数据（让推荐算法有数据可算）
在本地用云库环境变量跑一次 seed（或等 Render 起来后在 Render Shell 里跑）：
```bash
cd campus-mall/backend
# 用云库连接信息覆盖环境变量后执行：
DB_HOST=xxx DB_PORT=4000 DB_USER=root DB_PASSWORD=xxx DB_NAME=campus_mall \
  node sql/seed.js
```
看到「生成 120 用户 / 60 商品 / 1388 行为」即成功。

## 第 6 步：验收
打开 Vercel 地址 → 点「以演示账号登录」（user001 / 123456）→ 首页应出现「猜你喜欢」推荐位。
后台：`https://<vercel地址>/#/admin`，账号 admin / admin123。

---

## 常见问题
- **Render 免费服务会休眠**：15 分钟无访问后首次打开较慢（自动唤醒），演示前先点开一次即可。
- **图片上传在云端是临时盘**：Render 免费实例重启可能清空 `uploads/`，演示用默认字母封面即可（封面本就用首字占位，不依赖真实图）。
- **想换成 Supabase/Postgres？** 需把 `backend/sql/schema.sql` 与所有 `routes/*.js`、`services/recommend.js` 的 `?` 占位符改写为 `$1/$2` 并切换驱动为 `pg`，工作量较大，本方案刻意规避。
- **本地演示完全不受影响**：本地仍是 `start-campus-mall.bat` 一键起 MySQL+后端+前端，与云端互不影响。
