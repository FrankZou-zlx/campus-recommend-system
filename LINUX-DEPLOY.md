# 校园二手优选 · Linux 部署与运维手册

> 适用系统：RHEL 8/9/10、CentOS Stream、Rocky Linux、AlmaLinux、Fedora
> 对应系统：基于协同过滤算法的校园电商推荐网站（Vue3 免构建前端 + Node.js/Express 后端 + MySQL）
>
> 两种部署方式任选，也可以都试一遍（推荐先 Docker 起一套，再练裸机那套）：
>
> | | 方式 A：Docker Compose | 方式 B：裸机 Nginx + systemd |
> |---|---|---|
> | 上手速度 | 一条命令起全套 | 需要按步骤配置，但每一步都能看到 |
> | 依赖隔离 | 容器内自带 Node/MySQL，不污染系统 | 需要宿主机装 Node、MySQL、Nginx |
> | 适合场景 | 快速搭环境、演示、迁移 | 理解运维原理、贴近传统企业机房 |
> | 论文加分点 | 容器化、编排、数据卷持久化 | 服务托管、反向代理、SELinux、防火墙 |
>
> 两种方式的前端都不需要 `npm build` —— 前端的 vue / element-plus / axios 已内置在
> `frontend/vendor/` 里，属于"免构建"方案，Nginx 直接托管静态文件即可。

---

## 0. 部署前准备（两种方式都一样）

```bash
# 1) 看系统版本
cat /etc/redhat-release && uname -r

# 2) 记下本机 IP（后面用浏览器访问要用）
ip addr show | grep 'inet '

# 3) 确认能上外网（装包要用）
ping -c 2 mirrors.aliyun.com

# 4) 内存建议 ≥ 2G（MySQL + Node + Nginx 同时跑）
free -h
```

把项目代码放到 Linux 上，任选一种：

```bash
# ① 从 Windows 传（在 Windows 的 Git Bash / PowerShell 里执行）
scp -r D:/workbuddy.file/2026-09-03-13-40-36/campus-mall root@192.168.x.x:/root/

# ② 用 git（如果代码在仓库里）
git clone <你的仓库地址> /root/campus-mall

# ③ VMware 共享文件夹（装了 VMware Tools 才有）
ls /mnt/hgfs/          # 挂载后可直接 cp
```

> 传上去后确认 `ls /root/campus-mall` 能看到 `backend/ frontend/ demo-dist/ deploy/ docker-compose.yml`。

---

## 方式 A：Docker Compose 部署

### A1. 安装 Docker（国内源，快）

```bash
dnf install -y dnf-plugins-core
# 用阿里云镜像装 docker（官方源在国内很慢）
dnf config-manager --add-repo https://mirrors.aliyun.com/docker-ce/linux/centos/docker-ce.repo
dnf install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
systemctl enable --now docker
docker --version && docker compose version
```

配置镜像加速器（拉 mysql / nginx 镜像会快很多）：

```bash
mkdir -p /etc/docker
cat > /etc/docker/daemon.json <<'EOF'
{
  "registry-mirrors": [
    "https://docker.m.daocloud.io",
    "https://dockerproxy.com",
    "https://mirror.ccs.tencentyun.com"
  ],
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" }
}
EOF
systemctl restart docker
docker info | grep -A3 "Registry Mirrors"
```

> `log-opts` 那两行很重要：限制容器日志大小，否则跑久了日志能把磁盘写满（运维常见事故）。

### A2. 改配置并启动

```bash
cd /root/campus-mall
cp .env.example .env
vi .env          # 至少改掉三个密码和 JWT_SECRET（生成：openssl rand -hex 32）
```

```bash
docker compose up -d          # 构建镜像并后台启动（第一次会拉镜像，几分钟）
docker compose ps             # 三个容器都应是 Up / healthy
```

期望看到：

```
NAME          IMAGE                    STATUS
campus-db     mysql:8.0                Up (healthy)
campus-api    campus-mall-api:latest   Up (healthy)
campus-web    campus-mall-web:latest   Up
```

### A3. 灌演示数据（协同过滤算法需要的行为数据）

首次启动时 MySQL 容器已自动建好表（执行了 `deploy/mysql/init.sql`），
但**演示数据要手动灌一次**（120 个模拟用户 + 商品 + 浏览/收藏/购买行为）：

```bash
docker compose exec api node sql/seed.js
# 期望输出：用户 120 个、商品 60+ 件、行为 1000+ 条
```

> 灌完后用 `user001 / 123456` 登录，首页「猜你喜欢」就能看到协同过滤的推荐结果。

### A4. 验证

```bash
# 接口探活（走 Nginx 反代）
curl -s http://localhost/api/health
# 公告接口（公开，不需要登录）
curl -s http://localhost/api/notice/list | head -c 200
# 页面
curl -s -o /dev/null -w "前端 HTTP %{http_code}\n" http://localhost/
```

浏览器打开 `http://<服务器IP>/` 就能看到系统；`http://<服务器IP>/demo/` 是免后端的演示版。

### A5. Docker 日常命令

```bash
docker compose logs -f              # 全部日志
docker compose logs -f api          # 只看后端
docker compose restart api          # 重启后端
docker compose exec api sh          # 进后端容器
docker compose exec db mysql -ucampus -pcampus1234 campus_mall   # 进数据库
docker compose down                 # 停止（数据保留在数据卷）
docker compose up -d --build        # 改了代码后重新构建并启动
docker compose down -v              # ⚠ 连同数据卷一起删（数据库和图片全没）
```

### A6. 数据放在哪 / 怎么备份

| 数据 | 位置（Docker 数据卷） | 说明 |
|---|---|---|
| 数据库 | 卷 `campus-mall_db_data` | 容器删了也在，`down -v` 才会删 |
| 商品图片 | 卷 `campus-mall_uploads` | 对应容器内 `/app/uploads` |

```bash
# 备份数据库到宿主机当前目录
docker compose exec db sh -c 'exec mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" campus_mall' | gzip > campus_$(date +%F).sql.gz
# 恢复
gunzip < campus_2026-09-17.sql.gz | docker compose exec -T db sh -c 'exec mysql -uroot -p"$MYSQL_ROOT_PASSWORD" campus_mall'
```

---

## 方式 B：裸机部署（Nginx + systemd + MySQL）

### B1. 一键脚本（推荐先跑这个，再回头对照下面的手工步骤）

```bash
cd /root/campus-mall
sudo bash deploy/scripts/install-rhel.sh
```

脚本会自动完成：装 nginx / MySQL / Node 20 → 建系统用户 `campus` → 复制代码到 `/opt/campus-mall`
→ 装 npm 依赖（npmmirror 镜像）→ 建库建表 → 生成 `/etc/campus-mall/api.env`
→ 装 systemd 服务并开机自启 → 灌演示数据 → 配 Nginx 站点、SELinux、firewalld。

可选参数：

```bash
sudo bash deploy/scripts/install-rhel.sh --skip-seed        # 不要演示数据
sudo bash deploy/scripts/install-rhel.sh --skip-packages    # 依赖已装好，跳过装包
sudo WEB_PORT=8080 bash deploy/scripts/install-rhel.sh      # 换端口（80 被占用时）
```

### B2. 手工分步（想理解每一步就照这个来）

**① 装软件**

```bash
dnf install -y nginx mysql-server            # MariaDB 环境用 mariadb-server
dnf install -y policycoreutils-python-utils  # semanage 命令（SELinux 用）
systemctl enable --now mysqld
systemctl enable --now nginx

# Node 20（RHEL 9 有模块化仓库；RHEL 10 没模块就用 NodeSource）
dnf module install -y nodejs:20/common
node -v && npm -v
```

**② 建运行用户与目录**

```bash
useradd -r -s /sbin/nologin -d /opt/campus-mall campus
mkdir -p /opt/campus-mall /etc/campus-mall
cp -r backend frontend demo-dist deploy /opt/campus-mall/     # demo-dist 可选
mkdir -p /opt/campus-mall/backend/uploads/products
chown -R campus:campus /opt/campus-mall
```

**③ 装后端依赖**

```bash
cd /opt/campus-mall/backend
npm config set registry https://registry.npmmirror.com        # 国内加速
npm ci --omit=dev
```

**④ 建库建表**

```bash
mysql -uroot <<'SQL'
CREATE DATABASE IF NOT EXISTS campus_mall DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'campus'@'localhost' IDENTIFIED BY 'campus1234';
GRANT ALL PRIVILEGES ON campus_mall.* TO 'campus'@'localhost';
FLUSH PRIVILEGES;
SQL

mysql -ucampus -pcampus1234 campus_mall < sql/schema.sql
mysql -ucampus -pcampus1234 campus_mall -e "SHOW TABLES"      # 应看到 13 张表
```

**⑤ 写后端环境变量**（密码等敏感信息不写进代码）

```bash
cat > /etc/campus-mall/api.env <<EOF
PORT=3001
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=campus
DB_PASSWORD=campus1234
DB_NAME=campus_mall
JWT_SECRET=$(openssl rand -hex 32)
CLIENT_ORIGIN=http://$(hostname -I | awk '{print $1}')
EOF
chown root:campus /etc/campus-mall/api.env && chmod 640 /etc/campus-mall/api.env
```

**⑥ systemd 托管后端**

```bash
cp /opt/campus-mall/deploy/systemd/campus-mall-api.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now campus-mall-api
systemctl status campus-mall-api --no-pager
curl -s http://127.0.0.1:3001/api/health      # {"code":0,"msg":"ok"}
```

**⑦ Nginx 站点 + 反代**

```bash
cp /opt/campus-mall/deploy/nginx/campus-mall.conf /etc/nginx/conf.d/
mv -f /etc/nginx/conf.d/default.conf{,.bak} 2>/dev/null   # 默认站点占 80，挪走
nginx -t && systemctl reload nginx
```

**⑧ SELinux（RHEL 最容易踩的坑）**

```bash
# 允许 Nginx 反代到本机 3001（否则报 502）
setsebool -P httpd_can_network_connect 1

# 允许 Nginx 读取 /opt 下的站点文件（否则 403 Forbidden）
semanage fcontext -a -t httpd_sys_content_t "/opt/campus-mall/frontend(/.*)?"
semanage fcontext -a -t httpd_sys_content_t "/opt/campus-mall/demo(/.*)?"
restorecon -Rv /opt/campus-mall/frontend /opt/campus-mall/demo
```

**⑨ 防火墙**

```bash
firewall-cmd --permanent --add-service=http
firewall-cmd --permanent --add-service=https     # 配了 HTTPS 再加
firewall-cmd --reload
firewall-cmd --list-all | grep -E "services|ports"
```

**⑩ 灌演示数据**

```bash
cd /opt/campus-mall/backend
set -a; . /etc/campus-mall/api.env; set +a
node sql/seed.js
```

### B3. 验证清单

```bash
systemctl is-active campus-mall-api nginx mysqld     # 三个都要 active
ss -tlnp | grep -E ':80|:3001|:3306'                 # 端口都在监听
curl -s http://127.0.0.1:3001/api/health             # 后端直连
curl -s http://127.0.0.1/api/health                  # 走 Nginx 反代
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1/    # 200
```

浏览器打开 `http://<服务器IP>/` → 能登录 `user001 / 123456` 看到推荐 = 部署成功。

### B4. 部署配置自检（改过端口 / 路径 / 密码后跑一次）

```bash
python3 -m pip install pyyaml          # 仅首次需要
python3 deploy/scripts/check-deploy.py
```

会交叉校验 `compose / Dockerfile / Nginx / systemd / 安装脚本` 之间的**路径、端口、服务名、环境变量**是否对得上
（例如 Dockerfile 里 COPY 的目录是否存在、Nginx 反代的端口是否等于后端监听端口、systemd 的
EnvironmentFile 是否与脚本写入位置一致）。当前本项目 30 项全部通过。

### B5. 后续改代码怎么更新到服务器（重要）

第一次部署用 `install-rhel.sh`；**之后每次改代码，都用增量更新脚本**，几秒钟完成，不碰数据库：

```bash
# 1) Windows 上把新代码传过去（或 git pull）
scp campus-mall-deploy.tar.gz zou@<服务器IP>:/home/zou/

# 2) 服务器上解压并更新
cd /home/zou
tar -xzf campus-mall-deploy.tar.gz
cd campus-mall
sudo bash deploy/scripts/update.sh
```

它会做五件事：同步代码到 `/opt/campus-mall` → 按需装依赖 → 检查环境变量与权限 →
重载 Nginx（配置有变化时）→ 重启后端并验证。

**两个可选参数**：

| 参数 | 什么时候用 |
|---|---|
| `--schema` | 这次改动动了 `backend/sql/schema.sql`（新增字段/表）。它只导入表结构，不清数据 |
| `--reseed` | 想重新灌演示数据（**会清空商品/订单/行为**，演示前重置用） |

**改完前端记得让浏览器强刷一次**（Ctrl+F5）。Nginx 配置已把 JS/CSS 设为每次校验，
正常情况下之后不需要再手动强刷。

> ⚠️ **踩过的坑**：Nginx 曾对 `.js/.css` 设了 `expires 7d` 强缓存，而入口 `index.html` 引用的是
> 不带版本号的 `/app.js` —— 结果**改了前端，用户浏览器永远拿旧的**，表现为"某个功能点了没反应"，
> 而且普通刷新无效。现在配置已改为：图片/字体仍强缓存 7 天，**JS/CSS 每次回服务器校验**，
> **入口 HTML 不缓存**。规矩：静态资源要设强缓存，URL 就必须带版本号，二者必须成对出现。

---

## 4. 日常运维速查

| 我要做什么 | 命令 |
|---|---|
| 看后端状态 | `systemctl status campus-mall-api --no-pager` |
| 看后端实时日志 | `journalctl -u campus-mall-api -f` |
| 看最近 50 行日志 | `journalctl -u campus-mall-api -n 50 --no-pager` |
| 看昨天到现在的日志 | `journalctl -u campus-mall-api --since yesterday` |
| 重启后端 | `systemctl restart campus-mall-api` |
| 改完 database 配置后生效 | `vi /etc/campus-mall/api.env && systemctl restart campus-mall-api` |
| 看 Nginx 访问日志 | `tail -f /var/log/nginx/campus-mall.access.log` |
| 看 Nginx 错误日志 | `tail -f /var/log/nginx/campus-mall.error.log` |
| 只统计 502/500 有多少 | `grep -c " 502 " /var/log/nginx/campus-mall.access.log` |
| 看谁在访问（TOP IP） | `awk '{print $1}' /var/log/nginx/campus-mall.access.log \| sort \| uniq -c \| sort -rn \| head` |
| 数据库备份 | `bash /opt/campus-mall/deploy/scripts/backup-db.sh` |
| 数据库恢复 | `gunzip < /var/backups/campus-mall/xxx.sql.gz \| mysql -ucampus -p campus_mall` |
| 改前端页面 | `vi /opt/campus-mall/frontend/app.js` → 浏览器 `Ctrl+F5`（Nginx 不用重启） |
| 改后端代码 | `vi /opt/campus-mall/backend/src/...` → `systemctl restart campus-mall-api` |
| 看磁盘占用 | `df -h && du -sh /var/lib/mysql /opt/campus-mall/backend/uploads` |
| 看内存占用 | `free -h && ps -o pid,rss,cmd -C node` |
| 看端口占用 | `ss -tlnp \| grep 3001` |

**开机自启确认**（重启虚拟机后应自动恢复）：

```bash
systemctl is-enabled campus-mall-api nginx mysqld     # 三个都要 enabled
```

**自动备份**（每天凌晨 3:10，保留 7 天）：

```bash
crontab -e
# 追加这一行
10 3 * * * /bin/bash /opt/campus-mall/deploy/scripts/backup-db.sh >> /var/log/campus-mall-backup.log 2>&1
```

---

## 5. 故障排查对照表

| 现象 | 大概率原因 | 排查与解决 |
|---|---|---|
| 浏览器打不开页面 | 防火墙 / SELinux | `firewall-cmd --list-all`；`curl -I http://127.0.0.1/` 本机通不通 |
| 403 Forbidden | SELinux 阻止 Nginx 读 /opt | `ls -Z /opt/campus-mall/frontend` 看 context；跑 B2 第⑧步的 `semanage` + `restorecon` |
| 502 Bad Gateway | 后端没起 / SELinux 禁止反代 | `systemctl status campus-mall-api`；`setsebool -P httpd_can_network_connect 1` |
| 页面能开，登录报"网络错误" | 反代路径不对 | `curl -s http://127.0.0.1/api/health`；检查 Nginx 里 `proxy_pass http://127.0.0.1:3001;` |
| 登录后数据全空 | 没灌演示数据 | `docker compose exec api node sql/seed.js` 或裸机第⑩步 |
| `Access denied for user 'campus'` | 密码不一致 | 对比 `/etc/campus-mall/api.env` 与实际用户密码：`mysql -ucampus -p -e "select user,host from mysql.user"` |
| 后端起不来 | 配置或端口 | `journalctl -u campus-mall-api -n 100`；`ss -tlnp \| grep 3001` 看端口是否被占 |
| 上传的图片不显示 | 目录权限或 SELinux | `ls -l /opt/campus-mall/backend/uploads/products`；`chown -R campus:campus uploads` |
| `docker pull` 卡住 | 镜像源 | 配 `/etc/docker/daemon.json` 镜像加速器（见 A1），`systemctl restart docker` |
| `npm install` 慢 / 报错 | 国际源 | `npm config set registry https://registry.npmmirror.com` |
| 磁盘写满 | 容器/服务日志 | `df -h`；`journalctl --vacuum-size=200M`；确认 daemon.json 里配了日志上限 |
| 数据库表结构要重建 | schema 改了 | `mysql -uroot -e "DROP DATABASE campus_mall"` → 重新建库导入（**会丢数据，先备份**） |

**服务排错三步法**（遇到任何服务起不来，按顺序走）：

```bash
systemctl status <服务>            # 1. 看状态和最后的报错
journalctl -u <服务> -n 100        # 2. 看详细日志找原因
ss -tlnp | grep <端口>             # 3. 看端口/配置是否被占用或写错
```

---

## 6. 上生产前必须改的

| 项目 | 位置 | 怎么改 |
|---|---|---|
| 管理员弱密码 `admin123` | 数据库 `admin` 表 | 用 bcrypt 重新生成哈希后 `UPDATE admin SET password=?`，或改 `backend/sql/seed.js` 后重灌 |
| 数据库密码 | `/etc/campus-mall/api.env`（或 `.env`） | 改 `DB_PASSWORD` 并同步 `ALTER USER 'campus'@'localhost' IDENTIFIED BY '新密码'` |
| JWT 密钥 | 同上 `JWT_SECRET` | `openssl rand -hex 32` 生成后替换 |
| 演示数据 | 数据库 | 答辩演示留着；正式上线前清空 `user` / `product` / `interaction` 等表 |
| HTTPS | Nginx | `dnf install -y certbot python3-certbot-nginx && certbot --nginx -d 你的域名` |
| 只读演示账号 | 无 | 可给答辩老师一个只读账号，避免误删数据 |

---

## 7. 这套部署在论文里怎么写

「系统部署与运行」章节可以直接用上面这些真实操作：

1. **部署架构图**：浏览器 → Nginx（静态资源 + 反向代理）→ Node/Express（RESTful API）→ MySQL；虚线框标注"演示用 Docker 容器化部署"。
2. **容器化**：`docker-compose.yml` 编排三个服务（MySQL / API / Nginx），数据卷持久化数据库与商品图片，`depends_on + healthcheck` 保证启动顺序。
3. **服务托管与高可用细节**：systemd 的 `Restart=always` 让进程异常退出自动拉起；`EnvironmentFile` 把密码从代码里剥离（体现配置与代码分离）。
4. **安全加固**：SELinux 上下文与布尔值调整、firewalld 最小放行、敏感文件 640 权限、JWT 无状态鉴权。
5. **可运维性**：`journalctl` 日志、Nginx access log 分析、`mysqldump` 定时备份与恢复演练、`ss`/`systemctl` 排错步骤。
6. **两种部署方式的对比表**（本文档开头那张）可直接放进论文，用来说明"容器化与传统部署的取舍"。

> 答辩时如果被问"你的系统怎么部署、怎么保证稳定运行"，这套东西就是最好的回答：
> 一条 `docker compose up -d` 起全套；裸机方式用 systemd 保证开机自启与崩溃自愈；
> 日志、备份、防火墙、SELinux 都有明确的操作路径。
