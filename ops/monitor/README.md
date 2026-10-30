# 可观测性组件

三个零依赖 Node 脚本，不引入 Prometheus Server，也不需要任何付费监控服务。
整条链路是：**应用暴露指标 → 守护进程按阈值判定 → 邮件告警**。

```
campus-mall-api (Express)
  └─ /metrics            ← prom-client 输出 OpenMetrics 文本
       ↑ 每 15s 抓一次
  alert-watch.js          ← 阈值判定 + pending/firing/resolved 状态机
       └─ 触发 → notify.js → 裸 SMTP（自实现协议）→ 邮件
  monitor.js              ← 轻量看板，聚合展示
```

## 文件说明

| 文件 | 作用 | 默认端口 |
| --- | --- | --- |
| `monitor.js` | 指标看板，定时抓取 `/metrics` 并计算展示值 | 9099（只监听 127.0.0.1） |
| `alert-watch.js` | 告警判定守护进程，15s 一轮，持续 60s 才置为 firing | — |
| `notify.js` | 通知通道，支持 webhook 与 SMTP；465 隐式 SSL 与 587 STARTTLS 两条路径 | — |

## 告警规则

| 告警名 | 触发条件 | 默认阈值 |
| --- | --- | --- |
| `APIDown` | `/api/health` 不可达或非 200 | 连续 60s |
| `HighErrorRate` | 窗口内 5xx 占比超阈值 | `ERR_RATIO=0.01`（1%） |
| `HighP95Latency` | P95 延迟超阈值 | `P95_SEC=1`（1 秒） |
| `HighMemoryUsage` | 常驻内存超阈值 | `MEM_BYTES=300MB` |

每条规则在 `alert-watch.js` 里绑定了一段 `RUNBOOK` 片段，告警邮件正文会直接带上处置命令，
值班的人不需要先去翻文档才知道该敲什么。

## 状态机与降噪

`pending → firing → resolved` 三态：

- 首次越线进入 `pending`，**默认不发通知**（`NOTIFY_PENDING=0`），避免瞬时抖动刷屏；
- 持续超过 `ALERT_FOR_SEC`（默认 60s）才升为 `firing` 并发出邮件；
- 恢复后发 `resolved`，形成闭环，不会出现"告警了但不知道恢复了没有"；
- `firing` 状态每 30 分钟重复提醒一次（`NOTIFY_RESEND_MS`）。

## 环境变量

```bash
ALERT_SMTP_URL="smtp://<user>%40qq.com:<授权码>@smtp.qq.com:465"   # @ 必须编码为 %40
ALERT_WEBHOOK_URL=""          # 可选，与 SMTP 二选一或同时配置
P95_SEC=1
MEM_BYTES=314572800
ERR_RATIO=0.01
ALERT_FOR_SEC=60
NOTIFY_PENDING=0
NOTIFY_RESEND_MS=1800000
```

凭据只从环境变量读取，不写进代码；启动时若两个通道都没配置，会打印告警提示说明通知不可用。

## 自检方法

告警链路最容易出的问题是"看起来配好了，其实一封邮件也发不出去"。
触发一条可控告警来验证，比读代码可靠：

```bash
# 把内存阈值改到 1 字节，必然越线
MEM_BYTES=1 node alert-watch.js
# 等 60s（ALERT_FOR_SEC）→ 收到邮件即通路正常
```

相关事故记录见 `docs/incident/INC-004`。
