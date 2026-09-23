#!/usr/bin/env bash
# ============================================================
#  校园二手优选 · RHEL / CentOS / Rocky 一键部署脚本（裸机：Nginx + systemd + MySQL）
#
#  在【项目根目录】执行（root 身份）：
#     sudo bash deploy/scripts/install-rhel.sh
#
#  可选参数 / 环境变量：
#     --skip-seed                 不灌演示数据（只要空库）
#     --skip-packages             跳过 dnf 装包（依赖已装好时快很多）
#     WEB_PORT=8080               前端对外端口（默认 80）
#     DB_PASSWORD=xxx             数据库 campus 用户密码（默认 campus1234）
#
#  部署完成后：
#     前端页面   http://服务器IP/
#     公开演示版 http://服务器IP/demo/
#     接口探活   http://服务器IP/api/health
#
#  说明：所有改动都集中在 /opt/campus-mall、/etc/campus-mall、
#        /etc/systemd/system/campus-mall-api.service、/etc/nginx/conf.d/campus-mall.conf
# ============================================================
set -euo pipefail

# ---------------- 可调参数 ----------------
APP_DIR="/opt/campus-mall"
CONF_DIR="/etc/campus-mall"
DB_NAME="${DB_NAME:-campus_mall}"
DB_USER="${DB_USER:-campus}"
DB_PASSWORD="${DB_PASSWORD:-campus1234}"
WEB_PORT="${WEB_PORT:-80}"
WITH_SEED=1
SKIP_PACKAGES=0

for arg in "$@"; do
  case "$arg" in
    --skip-seed)     WITH_SEED=0 ;;
    --skip-packages) SKIP_PACKAGES=1 ;;
    *) echo "未知参数：$arg"; exit 1 ;;
  esac
done

# ---------------- 输出工具 ----------------
GREEN=$'\e[32m'; YELLOW=$'\e[33m'; RED=$'\e[31m'; CYAN=$'\e[36m'; NC=$'\e[0m'
step() { echo; echo "${CYAN}==> $*${NC}"; }
ok()   { echo "    ${GREEN}✔${NC} $*"; }
warn() { echo "    ${YELLOW}!${NC} $*"; }
die()  { echo "${RED}✘ $*${NC}" >&2; exit 1; }

# ---------------- 0. 前置检查 ----------------
[ "$(id -u)" -eq 0 ] || die "请用 root 运行：sudo bash deploy/scripts/install-rhel.sh"
[ -f "deploy/systemd/campus-mall-api.service" ] || die "请在项目根目录执行本脚本（找不到 deploy/ 目录）"
[ -d "backend/src" ] || die "找不到 backend/src，请在项目根目录执行"

SRC_DIR="$(pwd)"
OS_ID="$(. /etc/os-release && echo "${ID:-linux}")"
OS_VER="$(. /etc/os-release && echo "${VERSION_ID:-?}")"

echo "============================================================"
echo " 校园二手优选 · Linux 一键部署"
echo " 系统：${OS_ID} ${OS_VER}   源目录：${SRC_DIR}"
echo " 目标：${APP_DIR}   对外端口：${WEB_PORT}"
echo "============================================================"

# ---------------- 0.5 确保有可用的软件源 ----------------
# RHEL 未订阅时没有任何 repo（dnf 会报 "not registered"），这里自动配置
# 与 RHEL 9 二进制兼容的 Rocky 9 国内镜像源（阿里云），保证后面能装包。
if [ "$SKIP_PACKAGES" -eq 0 ]; then
  if ! dnf repolist --quiet 2>/dev/null | grep -q .; then
    warn "未检测到可用软件源（RHEL 未订阅？），自动配置阿里云 Rocky 9 镜像源"
    echo "[rocky9-baseos]
name=Rocky 9 BaseOS (aliyun mirror)
baseurl=https://mirrors.aliyun.com/rockylinux/9/BaseOS/x86_64/os/
enabled=1
gpgcheck=0

[rocky9-appstream]
name=Rocky 9 AppStream (aliyun mirror)
baseurl=https://mirrors.aliyun.com/rockylinux/9/AppStream/x86_64/os/
enabled=1
gpgcheck=0" > /etc/yum.repos.d/rocky9-mirror.repo
    # 关掉订阅检查，否则每次 dnf 都要去连 Red Hat（慢且报错）
    subscription-manager config --rhsm.manage_repos=0 >/dev/null 2>&1 || true
    dnf clean all >/dev/null 2>&1 || true
    if dnf repolist --quiet 2>/dev/null | grep -q .; then
      ok "已配置 Rocky 9 镜像源（与 RHEL 9 二进制兼容）"
    else
      warn "自动配源失败，请手动配置 /etc/yum.repos.d/ 后再跑（加 --skip-packages）"
    fi
  else
    ok "软件源正常"
  fi
fi

# ---------------- 1. 装基础软件 ----------------
if [ "$SKIP_PACKAGES" -eq 0 ]; then
  step "1/9 安装基础软件（nginx / 工具）"
  dnf install -y nginx curl tar policycoreutils-python-utils >/dev/null
  ok "nginx 与工具已就绪"

  step "2/9 安装数据库（MySQL，装不上则退回 MariaDB）"
  if dnf install -y mysql-server >/dev/null 2>&1; then
    DB_SERVICE="mysqld"
    ok "已安装 MySQL Server"
  elif dnf install -y mariadb-server >/dev/null 2>&1; then
    DB_SERVICE="mariadb"
    ok "已安装 MariaDB Server"
  else
    die "MySQL / MariaDB 都装不上，请检查网络或仓库配置"
  fi
  systemctl enable --now "$DB_SERVICE"
  ok "数据库服务 ${DB_SERVICE} 已启动并设为开机自启"
else
  if systemctl list-unit-files | grep -q '^mysqld.service'; then DB_SERVICE="mysqld";
  elif systemctl list-unit-files | grep -q '^mariadb.service'; then DB_SERVICE="mariadb";
  else die "找不到数据库服务，去掉 --skip-packages 重跑"; fi
  warn "已跳过装包，使用现有数据库服务：${DB_SERVICE}"
fi

# ---------------- 3. Node.js ----------------
step "3/9 准备 Node.js（需要 18 及以上）"
need_node=1
if command -v node >/dev/null 2>&1; then
  v="$(node -v | sed 's/^v//' | cut -d. -f1)"
  if [ "$v" -ge 18 ] 2>/dev/null; then need_node=0; ok "已安装 node $(node -v)"; fi
fi
if [ "$need_node" -eq 1 ]; then
  if dnf module list nodejs >/dev/null 2>&1; then
    dnf module install -y nodejs:20/common >/dev/null 2>&1 && ok "已通过 dnf module 安装 Node 20"
  fi
  if ! command -v node >/dev/null 2>&1; then
    warn "改用 NodeSource 源安装（国内网络可能较慢）"
    curl -fsSL https://rpm.nodesource.com/setup_20.x | bash - >/dev/null 2>&1
    dnf install -y nodejs >/dev/null
    ok "已安装 node $(node -v)"
  fi
fi
command -v node >/dev/null 2>&1 || die "Node.js 安装失败，可手动装好后加 --skip-packages 重跑"

# ---------------- 4. 运行用户与目录 ----------------
step "4/9 创建运行用户与部署目录"
if ! id campus >/dev/null 2>&1; then
  useradd -r -s /sbin/nologin -d "$APP_DIR" campus
  ok "已创建系统用户 campus（不可登录）"
else
  ok "系统用户 campus 已存在"
fi

mkdir -p "$APP_DIR" "$CONF_DIR" "$APP_DIR/backend/uploads/products"
# 拷贝代码（排除本机依赖、临时文件、截图等）
tar -cf - \
  --exclude='./backend/node_modules' \
  --exclude='./backend/.env' \
  --exclude='./backend/uploads' \
  --exclude='./.shots' \
  --exclude='./.git' \
  --exclude='./.patch*.js' \
  ./ | tar -xf - -C "$APP_DIR"
# 演示版（免后端）单独放一份，供 /demo/ 访问；没有就跳过
if [ -d "$SRC_DIR/demo-dist" ]; then
  rm -rf "$APP_DIR/demo"; cp -r "$SRC_DIR/demo-dist" "$APP_DIR/demo"
  ok "已复制公开演示版到 ${APP_DIR}/demo"
fi
ok "代码已复制到 ${APP_DIR}"

# ---------------- 5. 装依赖 ----------------
step "5/9 安装后端 npm 依赖（使用 npmmirror 镜像加速）"
cd "$APP_DIR/backend"
npm config set registry https://registry.npmmirror.com >/dev/null 2>&1 || true
if [ -f package-lock.json ]; then npm ci --omit=dev >/dev/null 2>&1 || npm install --omit=dev >/dev/null;
else npm install --omit=dev >/dev/null; fi
ok "依赖安装完成（$(ls node_modules | wc -l) 个包）"

# ---------------- 6. 数据库初始化 ----------------
step "6/9 初始化数据库（建库 / 建用户 / 建表）"
mysql -uroot <<SQL
CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASSWORD}';
ALTER USER '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASSWORD}';
GRANT ALL PRIVILEGES ON \`${DB_NAME}\`.* TO '${DB_USER}'@'localhost';
FLUSH PRIVILEGES;
SQL
ok "数据库 ${DB_NAME} 与用户 ${DB_USER} 已就绪"

if mysql -u"$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" -e "SHOW TABLES" | grep -q .; then
  warn "检测到已有数据表，跳过建表（如需重建：先 DROP DATABASE 再重跑）"
else
  mysql -u"$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" < sql/schema.sql
  ok "已导入 $(mysql -u"$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" -e 'SHOW TABLES' | tail -n +2 | wc -l) 张表"
fi

# ---------------- 7. 后端环境变量 ----------------
step "7/9 写入后端环境变量 ${CONF_DIR}/api.env"
if [ -f "$CONF_DIR/api.env" ]; then
  warn "已存在，保留原文件不覆盖（要改密码请直接编辑它）"
else
  JWT_SECRET="$(openssl rand -hex 32 2>/dev/null || echo "campus-$(date +%s)-secret")"
  cat > "$CONF_DIR/api.env" <<ENV
PORT=3001
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=${DB_USER}
DB_PASSWORD=${DB_PASSWORD}
DB_NAME=${DB_NAME}
JWT_SECRET=${JWT_SECRET}
CLIENT_ORIGIN=http://$(hostname -I | awk '{print $1}')
ENV
  ok "已生成（含随机 JWT 密钥）"
fi
chown root:campus "$CONF_DIR/api.env"
chmod 640 "$CONF_DIR/api.env"
ok "权限已设为 640 root:campus"

# ---------------- 8. systemd 托管后端 ----------------
step "8/9 配置 systemd 服务并启动后端"
install -m 644 "$SRC_DIR/deploy/systemd/campus-mall-api.service" /etc/systemd/system/campus-mall-api.service
systemctl daemon-reload
systemctl enable campus-mall-api >/dev/null 2>&1
chown -R campus:campus "$APP_DIR/backend" "$APP_DIR/frontend" "$APP_DIR/demo" 2>/dev/null || true
chmod -R u+rwX,g+rX,o+rX "$APP_DIR/backend/uploads"
systemctl restart campus-mall-api
sleep 3
if systemctl is-active --quiet campus-mall-api; then
  ok "campus-mall-api 已运行（开机自启）"
else
  warn "服务未启动成功，看日志：journalctl -u campus-mall-api -n 50 --no-pager"
fi

# 灌演示数据（120 用户 + 商品 + 协同过滤行为）
if [ "$WITH_SEED" -eq 1 ]; then
  echo "    …灌入演示数据（协同过滤算法需要的模拟行为）"
  set -a; . "$CONF_DIR/api.env"; set +a
  node sql/seed.js >/dev/null 2>&1 && ok "演示数据已灌入（可登录 user001 / 123456 体验推荐）" \
    || warn "灌数据失败，可手动执行：cd $APP_DIR/backend && node sql/seed.js"
fi

# ---------------- 9. Nginx + 防火墙 + SELinux ----------------
step "9/9 配置 Nginx、防火墙与 SELinux"
sed "s/listen       80;/listen       ${WEB_PORT};/" "$SRC_DIR/deploy/nginx/campus-mall.conf" \
  > /etc/nginx/conf.d/campus-mall.conf
# 默认站点占着 80 端口，容易和本站冲突，先挪走
[ -f /etc/nginx/conf.d/default.conf ] && mv -f /etc/nginx/conf.d/default.conf /etc/nginx/conf.d/default.conf.bak
nginx -t >/dev/null 2>&1 && ok "Nginx 配置语法检查通过" || die "Nginx 配置有误：nginx -t 查看详情"
systemctl enable --now nginx >/dev/null 2>&1
systemctl reload nginx
ok "Nginx 已启动并重载配置"

# SELinux（RHEL 默认 enforcing）：允许 Nginx 反代本机端口 + 读取 /opt 下的站点文件
if command -v getenforce >/dev/null 2>&1 && [ "$(getenforce)" != "Disabled" ]; then
  setsebool -P httpd_can_network_connect 1 && ok "SELinux：已允许 httpd 访问网络（反代后端需要）"
  semanage fcontext -a -t httpd_sys_content_t "${APP_DIR}/frontend(/.*)?" 2>/dev/null || true
  semanage fcontext -a -t httpd_sys_content_t "${APP_DIR}/demo(/.*)?" 2>/dev/null || true
  restorecon -Rv "$APP_DIR/frontend" "$APP_DIR/demo" >/dev/null 2>&1 || true
  ok "SELinux：站点目录上下文已设为 httpd_sys_content_t"
else
  warn "SELinux 已禁用或不可用，跳过相关设置"
fi

# firewalld
if systemctl is-active --quiet firewalld; then
  firewall-cmd --permanent --add-service=http >/dev/null
  [ "$WEB_PORT" != "80" ] && firewall-cmd --permanent --add-port="${WEB_PORT}/tcp" >/dev/null
  firewall-cmd --reload >/dev/null
  ok "firewalld 已放行 ${WEB_PORT} 端口"
else
  warn "firewalld 未运行，若外部访问不通请检查防火墙/SELinux/云安全组"
fi

# ---------------- 9.5 兼容性修复：混源升级可能弄坏 sshd ----------------
# 在未订阅的 RHEL 上用 Rocky/Alma 源装包时，依赖解析可能把 openssl-libs 升级到更新版本，
# 而系统自带的 openssh（针对旧 openssl 编译）会因版本不匹配启动失败（status=255），
# 表现为"SSH 突然连不上"。这里检测并升级 openssh 使其与新 openssl 匹配。
if systemctl list-unit-files 2>/dev/null | grep -q '^sshd.service'; then
  if ! systemctl is-active --quiet sshd; then
    warn "检测到 sshd 未运行（混源升级 openssl 后常见），尝试升级 openssh 以匹配"
    dnf upgrade -y openssh openssh-server openssh-clients >/dev/null 2>&1 || true
    systemctl restart sshd >/dev/null 2>&1 || true
    if systemctl is-active --quiet sshd; then
      ok "sshd 已恢复正常（可用 ssh 登录）"
    else
      warn "sshd 仍未恢复，请执行：journalctl -u sshd -n 30 查看原因"
    fi
  fi
fi

# ---------------- 完成 ----------------
IP="$(hostname -I | awk '{print $1}')"
echo
echo "${GREEN}============================================================${NC}"
echo "${GREEN} 部署完成${NC}"
echo "${GREEN}============================================================${NC}"
echo " 前端系统   ：http://${IP}$([ "$WEB_PORT" = "80" ] && echo "" || echo ":${WEB_PORT}")/"
echo " 公开演示版 ：http://${IP}$([ "$WEB_PORT" = "80" ] && echo "" || echo ":${WEB_PORT}")/demo/"
echo " 接口探活   ：http://${IP}$([ "$WEB_PORT" = "80" ] && echo "" || echo ":${WEB_PORT}")/api/health"
echo
echo " 管理员后台 ：admin / admin123        （生产环境请尽快改掉）"
echo " 普通用户   ：user001 / 123456"
echo
echo " 日常运维："
echo "   systemctl status campus-mall-api      # 后端状态"
echo "   journalctl -u campus-mall-api -f      # 后端实时日志"
echo "   tail -f /var/log/nginx/campus-mall.access.log"
echo "   systemctl restart campus-mall-api     # 改完 ${CONF_DIR}/api.env 后重启"
echo
