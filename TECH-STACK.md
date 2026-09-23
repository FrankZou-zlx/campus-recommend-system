# 校园二手优选 · 技术栈总览

> 用途：论文「技术选型」「系统设计」章节可直接引用；答辩被问"用了哪些技术"时按这份说。
> 所有版本号均已核对本机实际安装版本。

---

## 一、总体架构

**B/S 架构 · 前后端分离 · 五层划分**

```
浏览器（Vue3 SPA）
      ↓ HTTP / JSON
Nginx（静态托管 + 反向代理 /api、/uploads）  ← 同源，无跨域
      ↓
Express REST API（11 组路由 + 中间件 + JWT 鉴权）
      ↓                              ↘
MySQL 8.0（13 张表）           协同过滤推荐引擎（Item-CF + 冷启动兜底）
      ↑
上传文件存储（multer → uploads/products）
```

部署形态：**Docker Compose 三容器**（db / api / web）或 **裸机 Nginx + systemd + MySQL**。

---

## 二、前端技术

| 技术 | 版本 | 在本系统中的用途 |
|---|---|---|
| **Vue 3** | 3.4.38 | 整个应用：`createApp`、`setup()` 组合式 API、`reactive / ref / computed / watch`、自定义组件（`ProductCard`、`MiniChart`、`StarryBg`、`Notice` 等） |
| **Element Plus** | 2.7.6 | UI 组件库：表单校验、表格、分页、对话框、消息提示、标签、按钮 |
| **axios** | 1.x | HTTP 客户端；建了**两个实例**分别携带用户 token / 管理员 token（双通道） |
| **Canvas 2D** | 原生 | 管理员端梵高《星空》粒子背景（粒子公转 + 光团 + 油画拖尾）、商品封面兜底图生成 |
| **手写 SVG** | 原生 | 后台销量柱状图 / 近 7 日成交额折线图（**零依赖自绘，未引入 ECharts**） |
| **localStorage** | 浏览器 API | token 持久化；演示版数据持久化 |
| **Hash 路由** | 自实现 | 极简前端路由（`#/home`、`#/product/1`…）+ 身份守卫（`ADMIN_VIEWS`） |
| **CSS3** | — | CSS 变量主题换肤、毛玻璃、入场动画、骨架屏 shimmer、渐变 |
| **HTML5 / ES2022** | — | 语义化标签、`fetch/async-await`、模块化 IIFE |

**两个前端工程特色（答辩加分点）**：
1. **免构建方案**：把 vue / element-plus / axios 的浏览器构建版放进 `frontend/vendor/`，全站只由一个 `index.html` + 一个 `app.js` 组成，**不需要 npm、Vite、webpack**，部署时 Nginx 直接托管即可。
2. **同页双主题**：普通用户端暖橙主题、管理员端蓝色主题 + 星空背景，靠 CSS 变量作用域（`.admin-mode { --el-color-primary: … }`）整体换肤，组件代码零改动。

---

## 三、后端技术

| 技术 | 版本 | 用途 |
|---|---|---|
| **Node.js** | 22 | JavaScript 运行时（前后端同语言） |
| **Express** | 4.22.2 | Web 框架、路由分发、中间件管线 |
| **mysql2** | 3.24.3 | MySQL 驱动；**连接池**（`createPool`）、**参数化占位符 `?`**（防 SQL 注入）、Promise API |
| **jsonwebtoken** | 9.0.3 | JWT 无状态鉴权；**用户 / 管理员双通道**签发与校验 |
| **bcryptjs** | 2.4.3 | 密码加盐哈希存储（不存明文） |
| **multer** | 1.4.5 | 解析 `multipart/form-data`，商品图片多图上传落盘 |
| **cors** | 2.8.6 | 跨域白名单（同源部署时可不用，保留以支持分离部署） |
| **dotenv** | 16.6.1 | 环境变量注入，**配置与代码分离**（数据库密码不写进代码，便于上云/上服务器） |

**RESTful 接口分组（11 组）**：`auth`（注册/登录/管理员登录）、`user`（资料/地址）、`category`、`product`（列表/详情/发布/图片上传）、`cart`、`order`（下单/我的订单/**我卖出的**）、`message`（私信）、`recommend`（猜你喜欢）、`notice`（公告，公开可读）、`search`（搜索历史/热搜）、`admin`（数据看板/用户管理/商品管理/行为数据/协同过滤解释/图表/公告管理）。

**中间件与健壮性**：
- `auth` / `adminAuth` 两个鉴权中间件；
- 统一响应格式 `{ code, msg, data }`；
- 404 返回 JSON 而非 HTML；
- 4 参错误中间件 + `unhandledRejection` / `uncaughtException` 兜底（单个接口出错不会打崩整个服务）。

---

## 四、数据库技术（MySQL 8.0）

**13 张表**：`user`、`admin`、`category`、`product`、`product_image`、`address`、`cart`、`order`、`order_item`、`interaction`、`message`、`notice`、`search_log`

| 设计点 | 说明 |
|---|---|
| 字符集 | `utf8mb4`（支持 emoji）+ `utf8mb4_unicode_ci` |
| 存储引擎 | InnoDB（事务 + 行级锁 + 外键） |
| 主从表 | `order` / `order_item`（订单与订单明细一对多） |
| 一多图 | `product` / `product_image`（商品多图，首图设为封面） |
| **行为表** | `interaction`（user_id、product_id、type、score）—— **推荐算法的数据源** |
| 索引 | `username` 唯一索引、外键关联列索引 |
| SQL 能力 | 多表 `JOIN`、聚合函数（`COUNT/SUM`）、`GROUP BY`、`DATE_FORMAT` 时间格式化、`ORDER BY` 计算列（关键词命中数排序）、`LIMIT/OFFSET` 分页 |
| 初始化 | `schema.sql`（DDL）+ `seed.js`（脚本化灌入演示数据，可重复执行） |

---

## 五、算法技术（本系统核心亮点）

**基于物品的协同过滤（Item-based Collaborative Filtering）**，JavaScript 自实现，**前端演示版与后端用同一套公式**。

1. **构建加权评分矩阵**：把 `interaction` 行为折算成分值 —— 浏览 1 / 收藏 3 / 加购 4 / 购买 5；
2. **计算物品两两相似度**（加权余弦）：

   ```
   sim(i, j) = Σᵤ (rᵤᵢ · rᵤⱼ) / ( √Σᵤ rᵤᵢ² · √Σᵤ rᵤⱼ² )
   ```

3. **生成推荐**：`score(u, j) = Σ_{i ∈ 用户已交互} sim(i, j)`，排除已交互物品，取 TopN；
4. **冷启动兜底**：行为不足时退回「同类目热门 + 全站热门」混合推荐；
5. **可解释推荐**：后台「推荐算法行为数据」面板展示行为矩阵规模、最相似商品对、抽样用户的历史行为 → 推荐结果 → **每条推荐的相似度依据**。

**配套数据工程**：`seed.js` 灌入 **120 个模拟用户 / 60+ 商品 / 1000+ 条行为**，行为按用户偏好类目扎堆，使相似度可分、推荐结果有说服力（解决"单人开发没有真实用户"的问题）。

**检索相关**：多关键词搜索（空格分隔，OR 命中 + 全命中的排最前，相关度排序）；搜索日志统计热搜词（`GROUP BY` + `COUNT`）。

---

## 六、部署与运维技术

| 技术 | 用途 |
|---|---|
| **Docker / Docker Compose** | 三容器编排 `db`（mysql:8.0）/ `api`（node:22-alpine）/ `web`（nginx:1.27-alpine）；`healthcheck` + `depends_on` 控制启动顺序；命名数据卷持久化数据库与商品图片 |
| **Nginx** | 静态资源托管 + 反向代理 `/api`、`/uploads`（**同源部署，无需 CORS**）；gzip 压缩、静态缓存、`location ^~` 前缀优先级控制 |
| **systemd** | 后端服务托管：开机自启、崩溃自愈（`Restart=always`）、`EnvironmentFile` 配置分离、journald 日志 |
| **SELinux / firewalld** | RHEL 安全加固：`httpd_can_network_connect`、`semanage fcontext`、按需放行端口 |
| **MySQL 备份** | `mysqldump --single-transaction` 一致性备份脚本 + crontab 定时 + 保留策略 |
| **公网演示** | 免后端静态演示版（CloudStudio / Cloudflare Pages 等静态托管） |

---

## 七、工程与测试技术

- **免构建 SPA 工程结构**：`index.html` + `app.js` + `vendor/`，无打包工具链；
- **浏览器内 Mock 后端**（`demo/mock.js`）：在浏览器里完整模拟 30+ 个接口 + localStorage 持久化，实现"零后端可演示"，`window.__DEMO__` 开关切换真实/mock 通道；
- **自研回归测试工具链**（本机无 Playwright 的情况下）：
  - 无头 Edge 截图 + iframe harness DOM 断言（`_selftest.html`）
  - mock 层 Node 断言脚本（`_cftest.js` / `_cftest2.js`，23 项）
  - PNG 像素采样校验配色（纯标准库解码）
  - 模板引号配对检查（防整页白屏）
  - **部署配置一致性自检 30 项**（`check-deploy.py`：路径/端口/服务名/环境变量交叉校验）
- **配置与代码分离**：`.env` / `api.env` 管理数据库密码、JWT 密钥、端口；
- **演示账号体系**：`admin/admin123`（管理员）、`user001~user120/123456`（普通用户）。

---

## 八、论文「技术选型」章节可以怎么写

建议用一张表 + 3~4 段"为什么选它"的论证，例如：

| 层次 | 选型 | 主要理由 |
|---|---|---|
| 前端 | Vue 3 + Element Plus | 组件化开发效率高、响应式数据绑定契合电商列表与购物车频繁更新；Element Plus 组件齐全，减少自研 UI 成本 |
| 前端构建 | 免构建（本地 vendor 静态引入） | 降低环境依赖与部署复杂度，答辩/演示环境无需联网装依赖，一次部署到处可跑 |
| 后端 | Node.js + Express | 与前端同语言（JavaScript 全栈），异步非阻塞 I/O 适合高并发读的商品浏览场景；中间件机制便于统一鉴权与错误处理 |
| 数据库 | MySQL 8.0 | 关系模型契合用户-商品-订单的强关联业务；事务保证下单与库存一致性；生态成熟、校园环境易获取 |
| 算法 | Item-based CF | 物品数量相对稳定、相似度可离线计算；相比 User-CF 更适合"用户多而行为少"的校园场景；推荐结果可解释（可回溯到具体相似商品） |
| 部署 | Docker Compose / systemd + Nginx | 容器化保证环境一致性与一键迁移；systemd 保证服务自启与崩溃自愈；Nginx 同源反代简化前端配置并提升静态资源性能 |

**答辩高频问题速答**：
- *为什么不用 User-CF？* → 物品数稳定、相似度可预先计算；校园场景用户多但单人行为少，User-CF 相似度不稳。
- *数据从哪来？* → 无真实用户，用 `seed.js` 生成 120 用户 / 1000+ 行为，按类目偏好扎堆，使相似度具有区分度。
- *新用户怎么办？* → 冷启动兜底：同类目热门 + 全站热门混合推荐。
- *怎么证明算法在工作？* → 后台"推荐算法行为数据"面板：行为矩阵规模、最相似商品对（如高等数学 × 概率论 = 0.703，共同交互 16 人）、样例用户的推荐分与推荐依据。
- *系统怎么部署运维？* → `docker compose up -d` 一键起全套；裸机形态由 systemd 托管（开机自启、崩溃重启），Nginx 同源反代，另有备份脚本与 30 项部署一致性自检。
