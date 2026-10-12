#!/usr/bin/env bash
# =====================================================================
# 校园二手优选 —— 增量更新脚本
#
# 用途：把解压出来的最新源码同步到已部署的位置（默认 /opt/campus-mall），
#       并重启后端、重载 Nginx。相比重跑 install-rhel.sh，它不做装包/建库，
#       几秒钟完成，也不会动你的数据库。
#
# 用法：
#   cd /home/zou/campus-mall          # 解压后的源码目录
#   sudo bash deploy/scripts/update.sh
#
#   # 如果这次改动动了数据库表结构（schema.sql），额外加：
#   sudo bash deploy/scripts/update.sh --schema
#   # 默认会顺带补一批演示订单（只在订单表为空时生成，已有订单自动跳过）；
#   # 不想让它碰订单数据就加：
#   sudo bash deploy/scripts/update.sh --no-demo-orders
#   # 如果想重新灌演示数据（会清空商品/订单/行为，慎用）：
#   sudo bash deploy/scripts/update.sh --reseed
# =====================================================================
set -euo pipefail

SRC="$(cd "$(dirname "$0")/../.." && pwd)"
DST="${DST:-/opt/campus-mall}"
RUN_USER="${RUN_USER:-campus}"
NGINX_CONF="/etc/nginx/conf.d/campus-mall.conf"
SVC="campus-mall-api"
API_ENV="/etc/campus-mall/api.env"

DO_SCHEMA=0
DO_RESEED=0
SKIP_DEMO_ORDERS=0
for arg in "$@"; do
  case "$arg" in
    --schema) DO_SCHEMA=1 ;;
    --reseed) DO_RESEED=1 ;;
    --no-demo-orders) SKIP_DEMO_ORDERS=1 ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "未知参数: $arg"; exit 1 ;;
  esac
done

c_ok()   { printf '  \033[32m✔\033[0m %s\n' "$1"; }
c_info() { printf '  → %s\n' "$1"; }
step()   { printf '\n\033[1m==> %s\033[0m\n' "$1"; }

[ "$(id -u)" -eq 0 ] || { echo "请用 sudo 运行"; exit 1; }
[ -d "$DST" ] || { echo "找不到已部署目录 $DST，请先跑 install-rhel.sh"; exit 1; }
[ -d "$SRC/frontend" ] || { echo "源码目录不对：$SRC"; exit 1; }

# ⚠️ 安全护栏（2026-10-12 加）：
# 若在部署目录（/opt/campus-mall）内部执行本脚本，$SRC 会被推成 /opt/campus-mall，
# 于是下面的 rm -rf 会先把源码自己删掉，再 cp 必然失败 → 线上前端整目录被删、站点 500。
# 必须在「源码检出目录」里执行，例如：cd /home/zou/campus-mall && sudo bash deploy/scripts/update.sh
if [ "$SRC" = "$DST" ]; then
  cat >&2 <<ERR

  ✗ 源码目录与部署目录相同：$SRC
    不能在部署目录内部执行本脚本（会先删源码再复制，必然失败）。

    请改用源码目录执行，例如：
      cd /home/zou/campus-mall
      sudo bash deploy/scripts/update.sh

ERR
  exit 1
fi
# 源目录必须是一份完整源码，防止把残缺目录同步上去
[ -f "$SRC/frontend/index.html" ] || { echo "源码不完整：$SRC/frontend/index.html 不存在，已中止"; exit 1; }

step "1/5 同步代码到 $DST"
# 前端、后端源码、演示版：整份覆盖
rm -rf "$DST/frontend" "$DST/backend/src" "$DST/backend/sql" "$DST/deploy"
cp -r "$SRC/frontend" "$DST/frontend"
mkdir -p "$DST/backend"
cp -r "$SRC/backend/src" "$DST/backend/src"
cp -r "$SRC/backend/sql" "$DST/backend/sql"
cp -r "$SRC/deploy" "$DST/deploy"
[ -f "$SRC/package.json" ] && cp "$SRC/package.json" "$DST/" || true
# backend 的 package.json / .env 必须保留（里面有数据库密码）
if [ -f "$SRC/backend/package.json" ]; then cp "$SRC/backend/package.json" "$DST/backend/package.json"; fi
# 演示版（可选）：一起带过去，/demo/ 路径就能看到最新的
if [ -d "$SRC/demo" ]; then
  mkdir -p "$DST/demo"
  if command -v rsync >/dev/null 2>&1; then
    rsync -a --delete --exclude='_*' "$SRC/demo/" "$DST/demo/"
  else
    cp -r "$SRC/demo/." "$DST/demo/"
  fi
fi
# 自检 / 开发用文件（_ 开头）不该出现在服务器上：frontend 里会被公开访问，demo 里也没必要
rm -f "$DST"/frontend/_* "$DST"/demo/_* 2>/dev/null || true
chown -R "$RUN_USER:$RUN_USER" "$DST"
c_ok "代码已同步"

step "2/5 安装依赖（package.json 有变化时）"
cd "$DST/backend"
PKG_HASH_FILE="$DST/backend/node_modules/.pkg-hash"
NEW_HASH="$(sha256sum "$DST/backend/package.json" 2>/dev/null | awk '{print $1}')"
OLD_HASH="$(cat "$PKG_HASH_FILE" 2>/dev/null || echo none)"
if [ -d "$DST/backend/node_modules" ] && [ "$NEW_HASH" = "$OLD_HASH" ]; then
  c_info "依赖无变化，跳过（要强制重装：rm -rf node_modules 后再跑）"
else
  npm install --omit=dev --registry=https://registry.npmmirror.com >/dev/null 2>&1 || npm install --omit=dev >/dev/null 2>&1
  mkdir -p "$DST/backend/node_modules"
  echo "$NEW_HASH" > "$PKG_HASH_FILE"
  c_ok "依赖已安装/更新"
fi

step "3/5 环境变量与权限"
if [ ! -f "$API_ENV" ]; then
  echo "  未找到 $API_ENV，从模板生成"
  cp "$SRC/deploy/env/api.env.example" "$API_ENV"
  sed -i "s/^JWT_SECRET=.*/JWT_SECRET=$(head -c 32 /dev/urandom | base64 | tr -d '=+/')/" "$API_ENV"
fi
chown root:"$RUN_USER" "$API_ENV" 2>/dev/null || true
chmod 640 "$API_ENV" 2>/dev/null || true
c_ok "环境变量就绪（未改动已有配置）"

step "4/5 数据库"
# 后续几个 node 脚本要连数据库，先把 api.env 载入当前 shell
# （DB_USER/DB_PASSWORD 是 MySQL 账号，与系统用户无关，因此直接用 root 身份跑即可，
#   这与 install-rhel.sh 灌种子数据的方式保持一致，也避免 sudo 清空环境变量）
if [ -f "$API_ENV" ]; then set -a; . "$API_ENV"; set +a; fi

if [ "$DO_RESEED" -eq 1 ]; then
  c_info "重新灌入演示数据（FORCE=1，会清空商品/订单/行为）…"
  env FORCE=1 node "$DST/backend/sql/seed.js"
  c_ok "演示数据已重灌（含历史订单）"
elif [ "$DO_SCHEMA" -eq 1 ]; then
  DB_NAME="$(grep -oP '(?<=^DB_NAME=).*' "$API_ENV" 2>/dev/null || echo campus_mall)"
  DB_USER="$(grep -oP '(?<=^DB_USER=).*' "$API_ENV" 2>/dev/null || echo campus)"
  DB_PASS="$(grep -oP '(?<=^DB_PASSWORD=).*' "$API_ENV" 2>/dev/null || true)"
  c_info "导入表结构到 $DB_NAME（不会删数据）…"
  mysql -u"$DB_USER" -p"$DB_PASS" "$DB_NAME" < "$DST/backend/sql/schema.sql" && c_ok "表结构已更新"
else
  c_info "跳过（含表结构变更时请加 --schema）"
fi

# 演示订单：空表时自动补一批。
# 管理端「成交额 / 类目柱状图 / 近 7 日折线图」和卖家「我卖出的」都依赖订单数据，
# 全新部署时若没有它，答辩时看板会显示 ¥0.00、图表全空。
# seed-orders.js 自带幂等检查，已有订单会直接跳过，所以每次更新都跑也不会重复生成。
if [ "$DO_RESEED" -eq 0 ]; then
  if [ "$SKIP_DEMO_ORDERS" -eq 1 ]; then
    c_info "已按 --no-demo-orders 跳过演示订单"
  else
    c_info "检查演示订单（空库时自动生成，已有订单则跳过）…"
    if node "$DST/backend/sql/seed-orders.js" > /tmp/seed-orders.log 2>&1; then
      sed 's/^/     /' /tmp/seed-orders.log
    else
      printf '  \033[33m!\033[0m 演示订单生成失败（不影响服务运行）\n'
      tail -3 /tmp/seed-orders.log | sed 's/^/     /'
    fi
    rm -f /tmp/seed-orders.log
  fi
fi

step "5/5 重启服务与 Nginx"
# Nginx：配置有变化就重装并校验
if [ -f "$SRC/deploy/nginx/campus-mall.conf" ]; then
  if ! diff -q "$SRC/deploy/nginx/campus-mall.conf" "$NGINX_CONF" >/dev/null 2>&1; then
    cp "$SRC/deploy/nginx/campus-mall.conf" "$NGINX_CONF"
    c_info "Nginx 配置已更新"
  fi
fi
if command -v nginx >/dev/null 2>&1; then
  nginx -t >/dev/null 2>&1 && systemctl reload nginx && c_ok "Nginx 已重载" || echo "  ⚠ Nginx 配置检查未通过，请跑 nginx -t 查看"
fi
systemctl restart "$SVC"
sleep 2
if systemctl is-active --quiet "$SVC"; then
  c_ok "后端服务已重启并运行"
else
  echo "  ✗ 后端启动失败，日志："
  journalctl -u "$SVC" -n 30 --no-pager
  exit 1
fi
systemctl is-active --quiet mysqld 2>/dev/null && c_ok "MySQL 运行中" || true
# SELinux 文件上下文（新复制进来的文件可能没有标签）
if command -v restorecon >/dev/null 2>&1; then restorecon -R "$DST" >/dev/null 2>&1 || true; fi

IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
cat <<EOF

$(printf '\033[1m')更新完成$(printf '\033[0m')

  前端系统   ：http://${IP:-<服务器IP>}/
  接口探活   ：http://${IP:-<服务器IP>}/api/health

  浏览器请按 Ctrl+F5 强刷一次（JS/CSS 现在不缓存了，之后不用再刷）
  看日志     ：journalctl -u $SVC -f
EOF
