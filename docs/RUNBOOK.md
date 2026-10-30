# 运维手册（Runbook）

面向接手本系统的人。目标不是"知道系统怎么写的"，而是**出问题时知道先敲哪条命令**。

## 一、系统构成

| 组件 | 说明 | 位置 |
| --- | --- | --- |
| 前端 | 免构建 Vue3 静态文件，由 Nginx 直接托管 | `/opt/campus-mall/frontend` |
| 后端 API | Node + Express，systemd 托管，监听 3001 | `/opt/campus-mall/backend` |
| 数据库 | MySQL 8，库名 `campus_mall`，13 张表 | 本机 3306 |
| 反向代理 | Nginx，`/api`、`/uploads`、`/demo` 走 `location ^~` | `/etc/nginx/conf.d/campus-mall.conf` |
| 环境变量 | 数据库口令、JWT 密钥 | `/etc/campus-mall/api.env`（640 root:campus） |
| systemd 单元 | `campus-mall-api.service` | `/etc/systemd/system/` |
| 监控 | 指标 `/metrics`；告警守护进程 + 邮件通知 | `ops/monitor/` |

## 二、常用命令

```bash
# 服务状态与启停
systemctl status  campus-mall-api
systemctl restart campus-mall-api
systemctl is-enabled campus-mall-api

# 日志（最近 100 行 / 实时）
journalctl -u campus-mall-api -n 100 --no-pager
journalctl -u campus-mall-api -f

# Nginx
nginx -t                       # 改配置后必做，先测再 reload
systemctl reload nginx
tail -f /var/log/nginx/error.log

# 健康检查
curl -s http://127.0.0.1:3001/api/health
curl -s http://127.0.0.1:3001/metrics | head -20

# 数据库连通性
mysql -u campus -p campus_mall -e "SELECT COUNT(*) FROM product;"
```

## 三、发布与回滚

### 发布

**必须在源码目录执行**，不要在 `/opt/campus-mall` 里执行（`INC-001` 就是这么出的）：

```bash
cd /home/zou/campus-mall
sudo bash deploy/scripts/update.sh
```

脚本做四件事：同步源码 → 安装依赖 → 重载 Nginx → 重启后端。重复执行不破坏已有数据。

### 回滚

发布出问题时按这个顺序退，不用慌：

```bash
cd /home/zou/campus-mall
git log --oneline -5              # 找到上一个正常版本
git checkout <上一个正常的 commit>
sudo bash deploy/scripts/update.sh
```

`:warning:` 回滚前先备份数据库（见下一节），因为 `update.sh` 带 `--schema` 时会动表结构。
数据库若已变更，回滚代码也需要同步回滚表结构，此时优先恢复备份而不是逐条改。

## 四、备份与恢复

```bash
# 备份（默认输出到 /var/backups/campus-mall）
sudo bash deploy/scripts/backup-db.sh

# 恢复
gunzip -c /var/backups/campus-mall/campus_mall_20261030_134042.sql.gz \
  | mysql -u campus -p campus_mall
```

脚本备份完会自检三件事：`gzip -t` 能解压、末尾有 `Dump completed` 收尾标记、`CREATE TABLE` 数量不少于 13 张。
任一不满足就删掉残缺文件并以非 0 退出——**宁可让 cron 报错，也不留一个看起来正常、恢复时才炸的空壳备份**。

已挂 root crontab，每天 03:10 自动备份、保留 7 天：

```bash
10 3 * * * /bin/bash /opt/campus-mall/deploy/scripts/backup-db.sh >> /var/log/campus-mall-backup.log 2>&1
```

恢复演练建议每季度做一次，**没演练过的备份不算备份**。

## 五、告警处置对照表

告警邮件正文会附带对应的处置命令，这里是完整版：

| 告警 | 先看什么 | 处置 |
| --- | --- | --- |
| `APIDown` | `systemctl status campus-mall-api`、`journalctl -u campus-mall-api -n 50` | 进程挂了先看日志找崩溃原因；配置错则修 `/etc/campus-mall/api.env` 后重启 |
| `HighErrorRate` | 哪个路由在报 5xx：`topk(5, sum by (route,status) (rate(http_requests_total{status=~"5.."}[5m])))` | 单路由问题看该接口日志；全站 5xx 优先查数据库连接与磁盘 |
| `HighP95Latency` | 慢路由 topk | 慢查询加索引；前端大量请求时看是否是分页参数过大 |
| `HighMemoryUsage` | `node_heap_size_used_bytes` 趋势 | 持续上涨多为泄漏，重启止血后再排查；偶发尖峰可放宽阈值 |

## 六、常见故障速查

| 现象 | 最可能的原因 | 处置 |
| --- | --- | --- |
| 站点 500，前端目录为空 | 在部署目录内执行了 `update.sh` | 见 `INC-001`，从源码重新同步 |
| 改了前端但页面不变 | 入口 HTML 被强缓存 | 见 `INC-002`，检查响应头 `Cache-Control` |
| 某个接口恒失败，数据却没问题 | 判空表达式与类型不匹配 | 见 `INC-003`，查 `.length` 用法 |
| 告警判定正常但收不到邮件 | SMTP 会话握手不全 | 见 `INC-004`，465 分支需 EHLO |
| 商品显示"未分类" | 分类 ID 悬空 | 见 `INC-005`，`LEFT JOIN ... WHERE c.id IS NULL` 排查 |
| 页面能开但接口 404 | Nginx `location` 未加 `^~`，被静态规则截走 | 检查 `/api` 前缀的 location 优先级 |
| 后端起不来，报缺少环境变量 | `api.env` 缺失或权限不对 | 确认 `DB_PASSWORD`、`JWT_SECRET` 存在，属主 `root:campus` 640 |

## 七、日常巡检

```bash
sudo bash deploy/scripts/healthcheck.sh          # 全量输出
sudo bash deploy/scripts/healthcheck.sh --quiet  # 只输出 WARN / FAIL，适合挂 cron

# 部署账号只有 update.sh 一条免密 sudo 时，用这个入口走同一个巡检（只读，不做部署）
sudo bash deploy/scripts/update.sh --healthcheck
```

检查项：磁盘、内存、负载、服务状态、Nginx 配置、数据库连通、HTTP 健康端点、上传目录可写、备份新鲜度。
输出 `PASS / WARN / FAIL`，有 `FAIL` 时退出码非 0，可直接挂 cron。

已挂 root crontab，每天 08:00 静默巡检：

```bash
0 8 * * * /bin/bash /opt/campus-mall/deploy/scripts/healthcheck.sh --quiet >> /var/log/campus-mall-health.log 2>&1
```

最近一次真机执行（2026-10-30）结果 `FAIL 0 / WARN 0`，原始输出见 [`docs/ops/healthcheck-20261030.txt`](ops/healthcheck-20261030.txt)。

## 八、值班交接清单

- [ ] 服务是否全部 active（`systemctl` / `nginx` / `mysql`）
- [ ] 最近 24h 有无未处理的告警
- [ ] 最近一次备份时间与大小是否正常
- [ ] 磁盘使用率是否低于 80%
- [ ] 待处理的临时改动或手工热修（有没有改了服务器但没进仓库的）
