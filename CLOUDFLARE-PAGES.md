# 把演示版换成好记的网址（Cloudflare Pages 免费托管）

## 为什么要换 / 能换成什么

现在的地址 `https://4afe17af5106452284b34a76cabb3544.app.workbuddy.host` 里的长串是**平台自动分配的沙箱编号**，
改不了。而演示版（`demo-dist/`）是**纯静态 + 纯浏览器端运行**（推荐算法、数据都在浏览器里跑，不需要后端服务器），
所以可以放到任意静态托管上，并且**自己起名字**，例如：

```
https://campus-mall-demo.pages.dev        ← 前缀由你定
https://zlx-campus-mall.pages.dev
```

全程免费，不需要服务器、不需要备案。

> 已经打好的上传包：**`campus-mall-demo-pages.zip`**（8 个文件，0.59 MB）。

---

## ⚠️ 最重要的一条：一定要走「Pages 经典流程」，不要用新版 Workers 流程

2026 版 Cloudflare 控制台默认把人带进 **Workers（新版 Create an app 流程）**，部署出来的域名是
**`<项目名>.<账号ID>.workers.dev`** —— 实测：

| 平台 | 域名 | 国内能否打开 |
|---|---|---|
| Cloudflare **Workers**（新版流程） | `*.workers.dev` | **✗ 打不开**（DNS 被污染，解析到的假 IP 是 `199.59.149.204`，连不上） |
| Cloudflare **Pages**（经典流程） | `*.pages.dev` | ✓ 可正常解析（真实 Cloudflare IP） |
| 腾讯云 **EdgeOne Pages** | `*.edgeone.app` | ✓ 可正常解析（国内节点，最快） |
| Vercel | `*.vercel.app` | ✗ 超时打不开 |

**所以：看到 "Make something new" 那个选择页时，不要走 `Upload your static files`（那是 Workers），
而是点页面底部的 `Continue to Pages` 进经典 Pages 流程**，域名才会是 `xxx.pages.dev`。
如果已经用 Workers 部署了、拿到 `xxx.workers.dev`，那个地址在国内基本打不开，按下面的
「怎么切到经典 Pages 流程」重做一次即可。

### 怎么切到经典 Pages 流程

任选一种：

1. 直接在地址栏打开：`https://dash.cloudflare.com/?to=/:account/pages`
2. 左侧 **Compute → Workers & Pages** → 找 **Pages** 标签页
3. 在新建流程页面底部点小字 **"Need to use the legacy Pages workflow? Continue to Pages"**

进去后：**Create a project → Upload assets（Direct Upload）→ 起项目名 → 拖 zip → Deploy**，
得到的就是 `https://<项目名>.pages.dev`。

---

## 操作步骤（约 3 分钟）

### 第 1 步：注册 Cloudflare 账号（免费）

打开 https://dash.cloudflare.com/sign-up ，用邮箱注册并完成邮箱验证。
（不需要信用卡，不需要买任何东西。）

### 第 1.5 步：验证邮箱（必须做，否则上传会被拦）

拖入文件后，页面会弹出 **"Verify your account"**，并往你的邮箱发一封邮件
（发件人 `noreply@notify.cloudflare.com`，标题类似"您的帐户需要一个确认的电子邮件地址"）。

**去邮箱点那个橙色的「验证您的电子邮件」按钮**，点完跳回 Cloudflare 显示验证成功即可。

- QQ 邮箱里如果按钮点不动：点邮件正文下方的文字链接"验证电子邮件地址"，或点"显示原文"找到原始链接复制到浏览器打开；
- 验证完成后**回到 Workers & Pages 页面，重新拖一次 zip**（刚才那次拖拽会被这个验证打断）；
- 如果一直卡在验证这一步：注意页面顶部有一行灰色小字
  **"Need to use the legacy Pages workflow? Continue to Pages"** ——
  点它可以走**经典 Pages 上传流程**（只传静态文件时更直接）。

> ⚠️ **如果陷入"循环验证"**：点了邮件里的链接，回来拖 zip 又弹回 "Verify your account" ——
> 这是新版 Workers 创建流程对新账号的验证门槛，**不要一直重试**，直接从下面两个出口走：
>
> 1. 点验证页**顶部那行灰色小字**「**Need to use the legacy Pages workflow? Continue to Pages**」，
>    进入经典 Pages 界面 → **Create a project → Upload assets** → 起项目名 → 拖 zip。
>    经典 Pages 流程通常**不再要求账号验证**，这也是最省事的一条。
>    直达地址：`https://dash.cloudflare.com/?to=/:account/pages`
> 2. 还是不行就立刻换 **Netlify Drop**（见下方备选 D）：零注册、零验证，30 秒拿到网址。

### 备注：确认邮箱验证是否真的生效

Cloudflare 右上角头像 → **My Profile** → 看邮箱旁边是否显示已验证状态。
没有的话回到验证页点 **Resend email** 重新收一封（验证链接一般 24 小时内有效，用过一次就失效）。

### 第 2 步：进入 Pages 上传入口

登录后，左侧菜单：

```
Workers & Pages  →  Create application  →  选 "Pages" 标签  →  Upload assets
```

> **新版界面（左侧菜单没有 "Workers & Pages"）**：入口被收到 **Compute** 下面了
> —— 点左侧 `Compute` → 找 **Workers & Pages** → **Create application** → **Pages** → **Upload assets**。
>
> **如果看到 "Make something new" 选择页**（新版 Create an app 流程，四个选项 + 一个上传项），
> 直接选最后一项 **`Upload your static files`**（黄色文件夹图标）。其它别点：
> - `Connect GitHub` / `Connect with GitLab`：代码不在仓库里，不需要
> - `Start with Hello World!` / `Select a template`：那是示例和模板，不是你的网站
>
> **最省事的路子**：登录后的**首页第一张卡片**（标题 "Ship something new"）上就有一个
> **"Drop a folder, or a zip"** 的虚线框，**直接把 `campus-mall-demo-pages.zip` 拖进去**就开始了。
> - 别点旁边的 **Add a domain**（那是绑自有域名，要花钱，不是我们要走的路）
> - 别点第三张 **Protect your app**
> - 页面底部小字 **"Need to use the legacy Pages workflow? Continue to Pages"** 是**经典 Pages 流程**入口
>   —— 新版流程如果反复卡在账号验证，就走这里

### 第 3 步：给项目起名（**这一步就决定了网址**）

项目名填写你想要的网址前缀，例如 `campus-mall-demo`：

- 只能用小写字母、数字、连字符 `-`
- 它会直接变成域名：`campus-mall-demo` → `https://campus-mall-demo.pages.dev`
- 如果提示"已被占用"，换一个，比如 `campus-mall-demo-2026`、`zlx-campus-mall`

### 第 4 步：上传文件

把 **`campus-mall-demo-pages.zip` 整个拖进去**（也可以拖 `demo-dist` 文件夹）。
注意：压缩包里 `index.html` 就在根目录，**不要再套一层文件夹**，否则打开会是 404。

### 第 5 步：部署

点 **Deploy site**，等十几秒，就会出现你的新网址：

```
https://<你起的名字>.pages.dev
```

打开测试：能进首页、能用 `user001 / 123456` 登录、能看到「猜你喜欢」推荐 = 成功。

---

## 以后改了演示版怎么更新

1. 改完 `demo/app.js` / `demo/mock.js` / `demo/index.html` 后，同步到 `demo-dist/`：
   ```bash
   cd campus-mall
   cp demo/index.html demo/app.js demo/mock.js demo-dist/ && cp -r demo/vendor/. demo-dist/vendor/
   ```
2. 重新打包：
   ```bash
   python -c "import zipfile,os;src='demo-dist';out='campus-mall-demo-pages.zip';z=zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED);[z.write(os.path.join(r,f),os.path.relpath(os.path.join(r,f),src).replace(os.sep,'/')) for r,d,fs in os.walk(src) for f in fs];z.close()"
   ```
3. 回到 Cloudflare：项目 → **Create new deployment** → 拖入新 zip。

> 命令行党（可选）：`npx wrangler pages deploy demo-dist --project-name=campus-mall-demo`，一次命令完成上传。

---

## 几个注意事项

| 事项 | 说明 |
|---|---|
| 国内访问速度 | `pages.dev` 一般可正常打开；答辩前建议在**校园网和手机流量**各试一次，确认教室网络也能开 |
| 首次打开 | 建议 `Ctrl+F5` 强刷一次，避免浏览器缓存旧版 |
| 商品图片 | 演示版种子商品的图来自外链（picsum），若加载不出来会自动回退成**本地生成的色块封面**，页面不会破图 |
| 演示数据 | 存在**浏览器本地**（localStorage）。换电脑/换浏览器等于全新环境，点过清空搜索记录也不影响商品数据 |
| 免费额度 | 静态请求不限量，部署次数每月 500 次，个人演示完全够用 |
| 后端版系统 | 这个托管只放"免后端演示版"。**带数据库的完整系统**要按 `LINUX-DEPLOY.md` 部署到服务器 |

---

## 注册页打不开 / 报错怎么办（常见两种）

**① 页面中间一直"正在验证…"转圈，或提交时报 `Please complete the CAPTCHA and try again.`**
两者是同一个原因：Cloudflare 的人机验证（Turnstile，域名 `challenges.cloudflare.com`）**没加载出来或没通过**。
国内网络访问这个验证域名经常不稳，常见成因：
广告拦截/隐私类插件拦了它、浏览器缓存脏、当前网络到 Cloudflare 不稳。

- 用**无痕窗口**打开，或临时**关掉广告拦截插件**；
- 换网络试（手机热点通常就好了）；
- 换 Chrome / Edge 主浏览器，别用带各种插件的环境；
- 确认页面里那个"Verify you are human"的**小方框真的出现了并变成勾**，没出现就是没加载成功，此时点注册必然报这个错。

> ⚠️ 如果**验证框压根不出现**（只有转圈），说明网络到 `challenges.cloudflare.com` 不通，重试几次基本还是不行 ——
> **别再耗时间，直接走备选 D（Netlify Drop，不用注册）** 或备选 A（腾讯云 EdgeOne，国内网络更顺）。

**② 底部红字 `Invalid redirect_uri`**
这是**地址栏 URL 带了无效参数**（多半是从某个带 `redirect_uri=` 的链接跳进来的）。

- **把地址栏里 `?` 及后面的内容全部删掉**，只留干净的地址再回车：
  - 注册：`https://dash.cloudflare.com/sign-up`
  - 登录：`https://dash.cloudflare.com/login`
- 或者直接手敲上面这个地址，别从别处点进来。

> 两条同时出现时：先用无痕窗口打开 `https://dash.cloudflare.com/sign-up`（干净地址 + 无插件干扰），基本就能进去。

**如果折腾 5 分钟还进不去，直接走下面的备选 D（不用注册就能先拿到网址）**，别卡在这一步。

---

## 备选方案

**A. 腾讯云 EdgeOne Pages**（国内访问更快，需要腾讯云账号 + 实名）
同样是免费静态托管，控制台路径：EdgeOne → Pages → 新建项目 → 直接上传，域名形如 `xxx.edgeone.app`。

**B. Vercel**（`xxx.vercel.app`，需 Git 仓库或命令行）
`npx vercel --prod` 指向 `demo-dist` 目录即可；国内访问不如 Cloudflare 稳定。

**C. 绑定自己的域名**（可选，需要先有域名）
Cloudflare 项目 → Custom domains → 添加域名 → 按提示在域名商处改 NS。
如果以后你买了域名（如 `campus-mall.top`），就能变成 `https://campus-mall.top`，比 `pages.dev` 更正式。

**D. 完全不想注册？用 Netlify Drop（30 秒拿到网址）**
打开 https://app.netlify.com/drop ，**不用注册**，直接把 `campus-mall-demo-pages.zip` 拖进去，
立刻得到一个临时网址（形如 `https://random-name-123456.netlify.app`）。
适合先验证效果；之后在 Netlify 注册账号，就能把它改名成 `https://campus-mall-demo.netlify.app` 并长期保留。
（域名前缀不如 Cloudflare 好改，但胜在**零门槛**，注册卡住时的最佳退路。）

---

## 想再省事一点？

- **二维码**：拿到新网址后，可以生成二维码贴在论文附录或答辩 PPT 里，老师扫码直达。
  需要的话我可以帮你生成（把网址发我即可）。
- **短说明页**：也可以在论文附录里写一行"演示地址：https://xxx.pages.dev（普通用户 user001/123456，管理员 admin/admin123）"。

---

## 分工说明

| 谁做 | 做什么 |
|---|---|
| 你 | 注册 Cloudflare 账号、起项目名（决定网址）、拖 zip 上传 |
| 我 | 已经把上传包和这份步骤备好；后续演示版有改动，我随时同步 `demo-dist/` 并重新打包 |

> 账号必须你自己注册（涉及邮箱验证和账号安全，我不代注册）。卡在哪一步截图发我，我照着界面给你指。
