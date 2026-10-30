# 90 秒运维排查录屏 · 分镜脚本

一句话定位：**人为制造一次后端宕机，用自建监控发现、按 RUNBOOK 处置、一分钟内恢复并留下记录。**

---

## 一、开录前的准备（约 3 分钟，不录）

### 1. 打开看板（Windows 侧，窗口保持不关）

```bash
ssh -L 9099:127.0.0.1:9099 zou@172.24.126.135 -N
```

浏览器访问 <http://127.0.0.1:9099>，确认能看到「实时监控面板」。

### 2. 把告警判定阈值临时降到 20 秒（VM 侧）

生产默认 60 秒，录屏等不起，临时改短，**录完必须改回**。

```bash
ssh zou@172.24.126.135
pkill -f '^node /home/zou/alert-watch.js'
export ALERT_FOR_SEC=20
. /home/zou/restart-mon.sh
```

### 3. 确认基线全绿

```bash
sudo bash /opt/campus-mall/deploy/scripts/healthcheck.sh | tail -4
```

应为 `FAIL 0 项 / WARN 0 项`。

### 4. 确认邮箱能收信

收件箱里应有标题为 `【告警】SMTPSelfTest (info)` 的自检邮件。没有就先别录，先查 SMTP。

---

## 二、分镜（总约 95 秒）

| 时间 | 画面 | 操作 | 台词（照着念） |
| --- | --- | --- | --- |
| 0:00–0:08 | 监控看板 | 鼠标划过 QPS / P95 / 错误率 | 这是自建监控面板，数据来自后端 `/metrics`，每 15 秒抓一次，不依赖任何付费服务。 |
| 0:08–0:15 | 终端 | `sudo systemctl stop campus-mall-api` | 现在人为制造一次后端不可用，模拟线上故障。 |
| 0:15–0:30 | 终端 | `tail -f /home/zou/alert.log` | 告警先进入 pending，这是降噪：瞬时抖动不该惊动值班的人。 |
| 0:30–0:50 | 邮箱 | 切到 QQ 邮箱，打开新邮件 | 持续超过阈值才升级为 firing，邮件正文直接带处置命令，不用先去翻文档。 |
| 0:50–1:05 | 终端 | `sudo bash /opt/campus-mall/deploy/scripts/healthcheck.sh` | 巡检一把定位到服务层：后端未运行、健康端点不可达，其余检查项仍然正常。 |
| 1:05–1:15 | 终端 | `sudo journalctl -u campus-mall-api -n 20 --no-pager` | 日志里没有崩溃堆栈，确认是人为停止，不是代码问题。 |
| 1:15–1:25 | 终端 | `sudo systemctl start campus-mall-api` | 按 RUNBOOK 恢复服务。 |
| 1:25–1:35 | 终端 | 再跑一次巡检 | 回到 FAIL 0，告警同时自动置为 resolved，形成闭环。 |

> 时间对不上没关系，念完一句再进下一个动作即可。整套动作的重心是「**发现 → 定位 → 恢复 → 留痕**」。

实测时延（2026-10-30，阈值 20 秒）：停机 13:47:14 → pending 13:47:27（+13s）→ firing 13:47:42（+28s）→ 恢复 13:47:44 → resolved 13:47:57。

---

## 三、录完必须做的收尾

```bash
# 1) 告警阈值改回生产默认（60 秒）
pkill -f '^node /home/zou/alert-watch.js'
. /home/zou/restart-mon.sh

# 2) 确认服务与站点正常
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1/
sudo bash /opt/campus-mall/deploy/scripts/healthcheck.sh | tail -3
```

---

## 四、录屏工具

- Windows 自带：`Win + G` 打开 Xbox Game Bar，点录制；成品在 `视频\捕获`
- 或 OBS Studio：1080p / 30fps，只录终端与浏览器窗口，别把桌面其他东西录进去

---

## 五、这段录屏要证明什么（面试口述用）

1. 监控与告警是自己搭的、阈值自己定的，不是只会看别人做好的面板；
2. 懂 pending / firing 降噪的意义——故障不该变成误报刷屏；
3. 处置动作有据可依：RUNBOOK 与告警邮件里都直接带命令，不靠记忆；
4. 恢复后回查并留痕，有闭环意识，而不是「重启完就跑」。
