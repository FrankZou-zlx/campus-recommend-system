#!/usr/bin/env bash
# ============================================================
#  校园二手优选 · 数据库自动备份
#
#  手动执行： bash deploy/scripts/backup-db.sh
#  定时执行： sudo crontab -e   加入一行（每天凌晨 3:10 备份，日志留在 /var/log）
#      10 3 * * * /bin/bash /opt/campus-mall/deploy/scripts/backup-db.sh >> /var/log/campus-mall-backup.log 2>&1
#
#  产物：/var/backups/campus-mall/campus_mall_YYYYmmdd_HHMMSS.sql.gz
#  恢复：gunzip < 备份文件 | mysql -ucampus -p campus_mall
# ============================================================
set -euo pipefail

ENV_FILE="/etc/campus-mall/api.env"
BACKUP_DIR="/var/backups/campus-mall"
KEEP_DAYS=7

[ -f "$ENV_FILE" ] || { echo "找不到 $ENV_FILE，请先部署后端"; exit 1; }
# 读取数据库连接信息（systemd 的 EnvironmentFile 语法对 bash 同样适用）
set -a; . "$ENV_FILE"; set +a

mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y%m%d_%H%M%S)"
FILE="$BACKUP_DIR/${DB_NAME}_${STAMP}.sql.gz"

echo "[$(date '+%F %T')] 开始备份数据库 ${DB_NAME} ..."

# --single-transaction：不锁表（InnoDB 一致性快照），线上备份不中断服务
mysqldump \
  --single-transaction \
  --quick \
  --routines \
  --default-character-set=utf8mb4 \
  -u"${DB_USER}" -p"${DB_PASSWORD}" \
  "${DB_NAME}" | gzip > "$FILE"

SIZE="$(du -h "$FILE" | awk '{print $1}')"
echo "[$(date '+%F %T')] 备份完成：$FILE（$SIZE）"

# 清理过期备份
DELETED="$(find "$BACKUP_DIR" -name "${DB_NAME}_*.sql.gz" -type f -mtime "+${KEEP_DAYS}" -print -delete | wc -l)"
echo "[$(date '+%F %T')] 已清理 ${DELETED} 个超过 ${KEEP_DAYS} 天的旧备份"
