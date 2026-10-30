#!/usr/bin/env bash
# 校园二手交易平台 · 一键巡检
#
# 用法：sudo bash deploy/scripts/healthcheck.sh [--quiet]
#   --quiet  只输出 WARN / FAIL，适合挂 cron
#
# 退出码：0 = 全部通过（可能有 WARN）；1 = 存在 FAIL
set -uo pipefail

QUIET=0
[ "${1:-}" = "--quiet" ] && QUIET=1

SERVICE="campus-mall-api"
APP_DIR="/opt/campus-mall"
ENV_FILE="/etc/campus-mall/api.env"
BACKUP_DIR="/var/backups/campus-mall"
UPLOAD_DIR="$APP_DIR/backend/uploads"
DISK_WARN=80; DISK_FAIL=90
MEM_WARN=90
BACKUP_MAX_HOURS=48

FAILS=0; WARNS=0
LOG="${TMPDIR:-/tmp}/healthcheck.log"
: > "$LOG"

pass() { [ "$QUIET" -eq 1 ] || echo "[PASS] $*"; echo "[PASS] $*" >> "$LOG"; }
warn() { WARNS=$((WARNS+1)); echo "[WARN] $*" | tee -a "$LOG"; }
fail() { FAILS=$((FAILS+1)); echo "[FAIL] $*" | tee -a "$LOG"; }
head2() { [ "$QUIET" -eq 1 ] || echo; [ "$QUIET" -eq 1 ] || echo "== $* =="; }

echo "校园二手交易平台 · 巡检 $(date '+%F %T')" | tee -a "$LOG" >/dev/null

# ---------------- 1. systemd 后端 ----------------
head2 "后端服务"
if systemctl is-active --quiet "$SERVICE"; then
  since=$(systemctl show -p ActiveEnterTimestamp --value "$SERVICE")
  pass "$SERVICE 运行中（自 $since）"
  restarts=$(systemctl show -p NRestarts --value "$SERVICE" 2>/dev/null || echo 0)
  [ "${restarts:-0}" -gt 3 ] && warn "$SERVICE 重启次数偏多：$restarts"
else
  fail "$SERVICE 未运行 → systemctl status $SERVICE / journalctl -u $SERVICE -n 50"
fi

# ---------------- 2. Nginx ----------------
head2 "Nginx"
if systemctl is-active --quiet nginx; then
  pass "nginx 运行中"
else
  fail "nginx 未运行 → systemctl start nginx"
fi
if nginx -t >/dev/null 2>&1; then
  pass "nginx 配置语法正常"
else
  fail "nginx 配置有误 → nginx -t 查看详情（改完务必先测再 reload）"
fi

# ---------------- 3. 数据库 ----------------
head2 "数据库"
if [ -r "$ENV_FILE" ]; then
  # shellcheck disable=SC1090
  set -a; . "$ENV_FILE"; set +a
  if [ -z "${DB_PASSWORD:-}" ]; then
    warn "$ENV_FILE 未配置 DB_PASSWORD，跳过数据库检查"
  elif command -v mysql >/dev/null 2>&1; then
    if out=$(mysql -h"${DB_HOST:-127.0.0.1}" -P"${DB_PORT:-3306}" \
             -u"${DB_USER:-campus}" -p"$DB_PASSWORD" \
             -e "SELECT 1" "${DB_NAME:-campus_mall}" 2>&1); then
      pass "MySQL 连接正常（${DB_NAME:-campus_mall}）"
      if cnt=$(mysql -N -B -h"${DB_HOST:-127.0.0.1}" -P"${DB_PORT:-3306}" \
               -u"${DB_USER:-campus}" -p"$DB_PASSWORD" \
               -e "SELECT COUNT(*) FROM product" "${DB_NAME:-campus_mall}" 2>/dev/null); then
        [ "${cnt:-0}" -gt 0 ] && pass "商品表记录数：$cnt" || warn "商品表为空，确认是否刚重装"
      fi
    else
      fail "MySQL 连接失败：$(echo "$out" | tail -1)"
    fi
  else
    warn "未安装 mysql 客户端，跳过数据库检查"
  fi
else
  warn "读不到 $ENV_FILE（需 sudo），跳过数据库检查"
fi

# ---------------- 4. HTTP 健康端点 ----------------
head2 "HTTP 健康端点"
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:3001/api/health 2>/dev/null)
if [ "$code" = "200" ]; then
  pass "后端 /api/health → 200"
else
  fail "后端 /api/health → ${code:-无响应} → journalctl -u $SERVICE -n 50"
fi

code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1/ 2>/dev/null)
if [ "$code" = "200" ]; then
  pass "前端首页 → 200"
else
  fail "前端首页 → ${code:-无响应} → tail /var/log/nginx/error.log"
fi

# ---------------- 5. 磁盘 ----------------
head2 "磁盘"
while read -r use mnt; do
  use=${use%\%}
  if   [ "$use" -ge "$DISK_FAIL" ]; then fail "挂载点 $mnt 使用率 ${use}%（≥${DISK_FAIL}%）→ du -sh /var/log/* | sort -h | tail"
  elif [ "$use" -ge "$DISK_WARN" ]; then warn "挂载点 $mnt 使用率 ${use}%（≥${DISK_WARN}%）"
  else pass "挂载点 $mnt 使用率 ${use}%"
  fi
done < <(df -P -x tmpfs -x devtmpfs 2>/dev/null | awk 'NR>1 {print $5, $6}')

# ---------------- 6. 内存 ----------------
head2 "内存"
mem_use=$(free | awk '/^Mem:/ {printf "%d", ($3/$2)*100}')
if   [ "${mem_use:-0}" -ge "$MEM_WARN" ]; then warn "内存使用率 ${mem_use}%"
else pass "内存使用率 ${mem_use}%"
fi

# ---------------- 7. 负载 ----------------
head2 "负载"
cores=$(nproc 2>/dev/null || echo 1)
load1=$(awk '{print $1}' /proc/loadavg 2>/dev/null || echo 0)
if awk -v l="$load1" -v c="$cores" 'BEGIN{exit !(l > c*2)}'; then
  warn "1 分钟负载 $load1，超过 $cores 核的 2 倍"
else
  pass "1 分钟负载 $load1（${cores} 核）"
fi

# ---------------- 8. 上传目录 ----------------
head2 "上传目录"
if [ -d "$UPLOAD_DIR" ]; then
  if [ -w "$UPLOAD_DIR" ]; then
    pass "$UPLOAD_DIR 可写"
  else
    fail "$UPLOAD_DIR 不可写 → chown -R campus:campus $UPLOAD_DIR"
  fi
else
  warn "$UPLOAD_DIR 不存在"
fi

# ---------------- 9. 备份新鲜度 ----------------
head2 "备份"
if [ -d "$BACKUP_DIR" ]; then
  latest=$(ls -1t "$BACKUP_DIR"/*.sql.gz 2>/dev/null | head -1)
  if [ -n "$latest" ]; then
    age_h=$(( ( $(date +%s) - $(stat -c %Y "$latest") ) / 3600 ))
    if [ "$age_h" -gt "$BACKUP_MAX_HOURS" ]; then
      warn "最新备份已 ${age_h} 小时（阈值 ${BACKUP_MAX_HOURS}h）：$(basename "$latest")"
    else
      pass "最新备份 ${age_h} 小时前：$(basename "$latest")"
    fi
  else
    warn "$BACKUP_DIR 下没有备份文件 → deploy/scripts/backup-db.sh"
  fi
else
  warn "$BACKUP_DIR 不存在，尚未建立备份"
fi

# ---------------- 汇总 ----------------
echo
echo "-----------------------------------------"
echo "结果：FAIL ${FAILS} 项 / WARN ${WARNS} 项"
echo "详细日志：$LOG"
echo "-----------------------------------------"
[ "$FAILS" -gt 0 ] && exit 1
exit 0
