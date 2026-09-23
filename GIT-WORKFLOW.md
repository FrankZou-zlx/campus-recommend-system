# 用 Git 更新代码 —— 一次配置，以后两条命令

> 目的：解决"改了代码怎么弄到服务器上"。
> 配好之后，你在 Windows 上 `git push`，**服务器自动完成部署**（同步代码 → 重启后端 → 重载 Nginx），
> 不用再打包、不用再登录服务器敲命令。

---

## 一、这套东西长什么样

```
  Windows（你的开发机）                    虚拟机（RHEL 9.3）
  ┌──────────────────────┐   git push   ┌───────────────────────────────┐
  │ campus-mall/         │ ───────────► │ /home/zou/repos/campus-mall.git│  裸仓库
  │  改代码 → git commit │              │        │                      │
  └──────────────────────┘              │        │ post-receive 钩子触发 │
                                        │        ▼                      │
                                        │ /home/zou/campus-mall  检出代码 │
                                        │        │                      │
                                        │        ▼  deploy/scripts/update.sh
                                        │ /opt/campus-mall   真正在跑的代码 │
                                        │        │                      │
                                        │        ▼  systemctl restart   │
                                        │ campus-mall-api 服务重启        │
                                        └───────────────────────────────┘
```

一句话：**Windows 是工作台，虚拟机是运行环境，Git 是传送带。**

---

## 二、一次性设置（只做一次，约 5 分钟）

### 第 0 步：把代码传上去 —— 用 Git Bash 的 scp，别用 Xftp

> ⚠️ **Xftp 连不上是正常的**：修 sshd 那次把服务器 OpenSSH 升到了 9.9，
> 老版 Xftp 的算法协商对不上，只会报"连接到服务器时出现问题"这种笼统错误（服务器本身没问题）。
> Git 自带的 ssh 是新版（9.9p1），**完全能连**，所以直接用命令传，不需要修 Xftp。

在 **Windows 的 Git Bash** 里执行（`<服务器IP>` 换成你的，例如 172.24.126.135）：

```bash
scp "D:/workbuddy.file/2026-09-03-13-40-36/campus-mall-deploy.tar.gz" zou@<服务器IP>:/home/zou/
```

- 第一次连接会问 `Are you sure you want to continue connecting (yes/no/[fingerprint])?` → 输入 **yes** 回车；
- 然后提示 `zou@<IP>'s password:` → 输入登录密码（**输入时屏幕不显示任何字符，这是正常的**），回车。

传完在服务器上解压：

```bash
cd /home/zou && tar -xzf campus-mall-deploy.tar.gz && cd campus-mall
```

> 备选：如果你的 VMware 装了 VMware Tools，也可以直接把文件**拖进虚拟机窗口**。

### 第 1 步：在虚拟机上建仓库 + 装自动部署钩子

```bash
# 虚拟机上执行（你平时用 Xshell 连的那台）
cd /home/zou/campus-mall
sudo bash deploy/scripts/setup-git.sh
```

成功的话最后会打印出仓库路径和下一步命令。它会做四件事：
创建裸仓库 → 准备检出目录 → 装 `post-receive` 钩子 → 给 `zou` 放行"免密执行 update.sh"（**最小权限：只放行这一个脚本**）。

> 如果提示 `未检测到 git，正在安装…` 是正常的 —— 服务器首次部署时并不需要 git，
> 脚本会自动 `dnf install -y git` 补上。

### 第 1.5 步：确认 Windows 上能跑 `git`

在 Windows 随便开一个命令行，输入：

```bash
git --version
```

- **显示版本号**（如 `git version 2.47.1.windows.1`）→ 跳过，直接下一步；
- **提示"不是内部或外部命令"** → Windows 上还没装 Git。装法见
  [《安装 Git for Windows》](#附录安装-git-for-windows)（约 60 MB，一路 Next 即可）。

### 第 2 步（建议）：配 SSH 免密，否则每次 push 都要输密码

在 Windows 开一个能跑 `git`/`ssh` 的命令行（装完 Git 后自带的 **Git Bash** 最方便）：

```bash
# 1) 生成密钥（一路回车即可，不用设密码）
ssh-keygen -t ed25519 -C "zou@campus-mall"

# 2) 把公钥装到虚拟机上（会让你输一次密码，<服务器IP> 换成你的）
cat ~/.ssh/id_ed25519.pub | ssh zou@<服务器IP> "mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"

# 3) 验证：这次不应该再问密码
ssh zou@<服务器IP> "echo 免密成功"
```

### 第 3 步：在 Windows 上把项目连到仓库并首次推送

> ⚠️ **路径一定要用正斜杠 `/`**。Git Bash 里反斜杠是转义符，写 `cd D:\workbuddy...` 会报
> `No such file or directory`（而且报错里反斜杠会消失，看着像路径被吞了）。

```bash
cd /d/workbuddy.file/2026-09-03-13-40-36/campus-mall
# 或者用引号包起来写盘符：cd "D:/workbuddy.file/2026-09-03-13-40-36/campus-mall"

# 加远程仓库（<服务器IP> 换成你的，比如 172.24.126.135）
git remote add origin zou@<服务器IP>:/home/zou/repos/campus-mall.git

# 首次推送（-u 记住这个远程，以后直接 git push）
git push -u origin main
```

> 注意 `git remote add` 里那个 `origin` **后面跟的冒号是远程路径的一部分**，
> 和 Windows 盘符无关，不用改写法。

推送过程中你会看到钩子的输出：`收到推送，开始自动部署` → `代码已同步` → `后端服务已重启并运行`。
**看到这些就说明全链路通了。**

---

## 三、以后的日常流程（就三条命令）

```bash
cd D:/workbuddy.file/2026-09-03-13-40-36/campus-mall

git add -A
git commit -m "改了啥，一句话"
git push
```

推完等 5~10 秒，浏览器 **Ctrl+F5** 一下就是新版本。

> 提示：现在 Nginx 已经把 JS/CSS 改成"每次校验"，正常情况下**不需要每次强刷**；
> 首页入口 HTML 也不缓存。如果哪天发现改动没生效，先排查是不是前端没提交（`git status` 看一眼）。

---

## 四、出问题怎么查

| 现象 | 原因与处理 |
|---|---|
| `cd D:\workbuddy...` 报 `No such file or directory`（报错里反斜杠全没了） | **Git Bash 里路径必须用正斜杠 `/`**。反斜杠在 bash 里是转义符（`\w` 会被吃成 `w`）。正确写法：`cd /d/workbuddy.file/2026-09-03-13-40-36/campus-mall` 或 `cd "D:/workbuddy.file/2026-09-03-13-40-36/campus-mall"` |
| `git push` 报 `Permission denied` | SSH 连不上。先单独试 `ssh zou@<IP>`，能进就检查 `git remote -v` 里的路径有没有写错 |
| `git push` 报 `does not appear to be a git repository` | 服务器端还没建仓库 —— 回到**第 1 步**跑 `sudo bash deploy/scripts/setup-git.sh` |
| `git` 提示"不是内部或外部命令" | Windows 没装 Git，见[附录](#附录安装-git-for-windows)；装完**必须重开命令行窗口** |
| push 成功，但页面没变 | ① 看钩子输出里有没有 `✗`（它会把失败原因打出来）② 服务器上 `journalctl -u campus-mall-api -n 30` 看后端 ③ `git status` 确认改动真的提交了 |
| 钩子报 `update.sh 语法错误` | 脚本被改坏了。钩子会**中止部署、线上保持旧版本**，不会把服务搞挂。修好后重新 `git push` |
| 想手动部署一次 | 服务器上 `sudo bash /home/zou/campus-mall/deploy/scripts/update.sh` |
| 这次改动了数据库表结构 | 手动跑 `sudo bash .../update.sh --schema`（钩子里只能免密跑不带参数的版本） |
| 想重新灌演示数据 | `sudo bash .../update.sh --reseed`（**会清空商品/订单/行为**，演示前重置用） |
| 后台成交额 ¥0.00、图表全空 | 库里没有订单。`update.sh` 在订单表为空时会自动补 48 笔演示订单，所以再跑一次 `sudo bash /opt/campus-mall/deploy/scripts/update.sh` 即可（已有订单会跳过，不会重复生成） |

### 回滚到上一个版本

```bash
# 方式一（推荐，保留历史，安全）
git log --oneline -10            # 找到要退回去的那个提交号
git revert <提交号>              # 生成一个"反向提交"
git push                         # 推上去，服务器自动部署回旧状态

# 方式二（强制回退，会覆盖远端历史，谨慎）
git reset --hard <提交号>
git push --force
```

---

## 五、以后想给招聘方看：推到 Gitee 或 GitHub

本地仓库现在就能用，但**招聘方点不进去**。等你想公开时，注册一个账号后（Gitee 注册最简单、国内快；GitHub 更通用但国内网络不稳），执行：

```bash
# 以 Gitee 为例（先在网页上创建一个空仓库，不要勾选自动生成 README）
git remote add gitee git@gitee.com:<你的用户名>/campus-mall.git
git push gitee main
```

之后 `git push origin main` 推虚拟机、`git push gitee main` 推 Gitee，互不影响。

> ⚠️ 公开前先把 `admin123` 换掉（`backend/sql/seed.js`），仓库里不要出现任何真实密码。
> `.gitignore` 已经帮你排除了 `.env`、`node_modules`、上传的图片。

---

## 六、简历里怎么写这一段（这就是 CI/CD 的雏形）

> 自建 Git 服务器（bare 仓库）并配置 `post-receive` 钩子，实现提交即自动部署：
> 推送后自动检出代码、执行幂等的增量更新脚本（同步文件 → 按需安装依赖 → 重载 Nginx → 重启 systemd 服务 → 健康检查），
> 并通过 `sudoers` 最小权限放行（仅授权单个部署脚本，而非完整 root）；
> 钩子内含语法预检与失败中止，**部署失败时线上保持旧版本**，避免半成品上线。

这套话术的每一个点，代码里都真的实现了。下一步加 GitHub Actions（构建镜像 → 推送仓库）就串成完整流水线。

---

## 附录：安装 Git for Windows

> 只有第 1.5 步里 `git --version` 报"不是内部或外部命令"时才需要做这一步。

1. **下载**（华为云镜像，国内速度快，约 60 MB）：
   `https://mirrors.huaweicloud.com/git-for-windows/v2.47.1.windows.1/Git-2.47.1-64-bit.exe`
2. **双击安装**，一路 **Next** 即可（默认选项都对，不用改；装完会自带一个命令行工具 **Git Bash**）。
3. ⚠️ **把已经打开的命令行窗口全部关掉，重新开一个** —— PATH 是窗口启动时读取的，不重开不生效。
4. **验证**：新窗口里敲 `git --version`，能打印版本号就成功了。

装完后开始菜单里会出现 **Git Bash**，以后所有 Git 命令都在它里面敲最省事。

> 应急方案（不装任何东西）：WorkBuddy 自带了一份 PortableGit，双击
> `C:/Users/zlx59/.workbuddy/vendor/PortableGit/bin/bash.exe` 也能得到一个能跑 git 的窗口。
> 但它属于 WorkBuddy 的内部目录，软件更新后可能变动，**只当临时应急，不建议长期依赖**。
