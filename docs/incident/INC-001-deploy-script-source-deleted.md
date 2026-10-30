# INC-001 部署脚本在部署目录内执行，导致源码被删除、站点 500

| 项 | 内容 |
| --- | --- |
| 编号 | INC-001 |
| 日期 | 2026-10-12 |
| 等级 | P1（生产不可用） |
| 影响面 | 整站前端 500，持续约 40 分钟 |
| 状态 | 已修复，已加硬性护栏 |

## 现象

执行更新脚本后，浏览器访问站点返回 500。Nginx 日志报：

```
open() "/opt/campus-mall/frontend/index.html" failed (2: No such file or directory)
```

## 排查过程

1. `systemctl status campus-mall-api` — 后端正常运行，排除 API 故障。
2. `curl -I http://127.0.0.1/` — Nginx 本身在跑，但静态文件取不到。
3. `ls /opt/campus-mall/frontend` — **目录为空**，不是权限问题，是文件没了。
4. 回看执行记录：更新脚本是在 `/opt/campus-mall` 目录内执行的，而不是源码目录。
5. 读脚本第 73–74 行：

```bash
rm -rf "$DST/frontend" "$DST/backend/src" ...
cp -r "$SRC/frontend" "$DST/frontend"
```

## 根因

脚本设计上假定 `SRC`（源码检出目录）与 `DST`（部署目录）是两个不同路径。
在部署目录内执行时 `SRC == DST`，于是 `rm -rf` 先删掉了源，紧接着的 `cp` 自然失败，
结果是**自己删了自己**，还删得很彻底。

这不是"操作失误"这么简单——脚本没有对前提条件做任何校验，把安全性完全寄托在执行者的记忆上，
属于设计缺陷。

## 修复

在脚本开头、任何删除动作之前加前置判断：

```bash
if [ "$SRC" = "$DST" ]; then
  cat >&2 <<ERR
  ✗ 源码目录与部署目录相同：$SRC
    不能在部署目录内部执行本脚本（会先删源码再复制，必然失败）。
    请改用源码目录执行，例如：
      cd /home/zou/campus-mall && sudo bash deploy/scripts/update.sh
ERR
  exit 1
fi
```

用同样的方式重新执行，同步、装依赖、重载 Nginx、重启后端全部完成，站点恢复。

## 预防

- 破坏性操作前必须校验前置条件，**能自动拦住的错误不要写进文档让人记**；
- `DEPLOY.md` 与 `README` 里把正确执行路径写成第一条，并注明"必须在源码目录执行"；
- 恢复动作本身也要有兜底：本次靠 `git clone` 重新取回源码,如果源码只在服务器上,这一删就是不可恢复的。**源码必须另有副本**（本项目为本地仓库 + GitHub + Gitee 三处）。

## 经验

> 脚本越"自动"，越要在第一步就假设人会站错位置。
