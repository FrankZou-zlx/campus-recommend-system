# INC-004 SMTP 465 隐式 SSL 未发 EHLO，告警邮件全部发不出去

| 项 | 内容 |
| --- | --- |
| 编号 | INC-004 |
| 日期 | 2026-10-25 |
| 等级 | P1（监控失效） |
| 影响面 | 全部告警邮件，监控形同虚设 |
| 状态 | 已修复，已用真实告警验证 |

## 现象

告警规则能正常判定（日志里能看到 `PENDING` → `firing`），但收件箱一封邮件都没有。
`notify.js` 的返回值显示 SMTP 通道失败，错误信息是：

```
503 Error: send HELO/EHLO first
```

## 排查过程

1. 确认网络与端口：`nc -zv smtp.qq.com 465` 通，排除防火墙。
2. 手工用 `openssl s_client -connect smtp.qq.com:465` 连上去，逐条发命令观察：
   - 连接建立后直接 `AUTH LOGIN` → 服务器拒绝；
   - 先发 `EHLO` 再 `AUTH LOGIN` → 正常。
3. 回到代码，对比两条分支：

```js
// 587 STARTTLS 分支
await sendCmd(sock, `EHLO campus-mall`);   // 有
...
await sendCmd(s, `EHLO campus-mall`);      // 升级 TLS 后再发一次，有

// 465 隐式 SSL 分支
await readReply(sock);
await sendCmd(sock, 'AUTH LOGIN');          // 直接认证，缺 EHLO
```

## 根因

465 是隐式 SSL：TLS 在连接建立时就完成了，**但 SMTP 协议层的会话仍然要按 RFC 5321 走一遍**，
`EHLO` 是进入认证状态的前置条件，跟是否已加密无关。
写代码时的直觉是"加密了就不用握手了"，这个直觉是错的——TLS 握手和 SMTP 会话握手是两回事。

因为 587 分支写对了，只在 465 分支漏了，问题只在特定配置下暴露，更难发现。

## 修复

465 分支在建立连接后补发 EHLO 并读取响应，然后才进入 AUTH：

```js
await readReply(sock);
await sendCmd(sock, 'EHLO campus-mall'); // 隐式 SSL 也必须 EHLO，否则后续命令被 503 拒绝
```

## 验证

配置好真实收件地址后，**主动制造一次越线**来验证通路，而不是等真实故障：

```bash
MEM_BYTES=1 node alert-watch.js    # 内存阈值设到 1 字节，必然触发
```

60 秒后收到告警邮件，`notify.js` 返回 `{"mail":1}`，说明链路真的通了。

## 预防

- 两条连接路径共用同一个"会话初始化"函数，避免各写一套、遗漏一处；
- **监控本身必须被验证**：配完告警要主动触发一次，确认收得到，否则监控的可靠性是假设而非事实；
- 中文主题需按 RFC 2047 编码（`=?UTF-8?B?...?=`），否则部分邮箱显示乱码，这一点在实现时一并处理。

## 经验

> "监控配好了"和"监控能报警"是两件事。
> 没有做过告警演练的监控系统，等于没有监控。
