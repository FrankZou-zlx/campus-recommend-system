#!/usr/bin/env bash
# =====================================================================
# 校园二手优选 —— 在服务器上一次性搭建「自建 Git 仓库 + push 即自动部署」
#
# 效果：在 Windows 上 `git push` 之后，服务器会自动：
#         检出最新代码 → 跑 deploy/scripts/update.sh（同步到 /opt、重启后端、重载 Nginx）
#       全程不需要登录服务器、不需要手敲任何命令。
#
# 用法（在虚拟机上，只跑一次）：
#   sudo bash /home/zou/campus-mall/deploy/scripts/setup-git.sh
#
# 可选环境变量：
#   GIT_USER=zou        允许推送的 Linux 用户（默认 zou）
#   BRANCH=main         部署分支（默认 main）
#   REPO_DIR=...        裸仓库位置（默认 /home/zou/repos/campus-mall.git）
#   WORK_DIR=...        检出目录（默认 /home/zou/campus-mall）
#   NO_AUTO=1           只建仓库、不装自动部署钩子（那就每次自己在服务器上跑 update.sh）
# =====================================================================
set -euo pipefail

GIT_USER="${GIT_USER:-zou}"
BRANCH="${BRANCH:-main}"
REPO_DIR="${REPO_DIR:-/home/${GIT_USER}/repos/campus-mall.git}"
WORK_DIR="${WORK_DIR:-/home/${GIT_USER}/campus-mall}"
NO_AUTO="${NO_AUTO:-0}"
SUDOERS_FILE="/etc/sudoers.d/campus-git-deploy"

ok()   { printf '  \033[32m✔\033[0m %s\n' "$1"; }
info() { printf '  → %s\n' "$1"; }
step() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }
die()  { printf '  ✗ %s\n' "$1" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "请用 sudo 运行"
id "$GIT_USER" >/dev/null 2>&1 || die "用户 $GIT_USER 不存在"
command -v git >/dev/null 2>&1 || die "服务器没装 git：dnf install -y git"

step "1/4 创建裸仓库 $REPO_DIR"
mkdir -p "$(dirname "$REPO_DIR")"
if [ -d "$REPO_DIR" ]; then
  info "已存在，跳过创建（不会动里面的历史）"
else
  git init --bare -b "$BRANCH" "$REPO_DIR" >/dev/null 2>&1 || git init --bare "$REPO_DIR" >/dev/null
  ok "裸仓库已创建"
fi
chown -R "$GIT_USER:$GIT_USER" "$REPO_DIR"

step "2/4 准备检出目录 $WORK_DIR"
[ -d "$WORK_DIR" ] || { mkdir -p "$WORK_DIR"; chown "$GIT_USER:$GIT_USER" "$WORK_DIR"; }

if [ "$NO_AUTO" -eq 1 ]; then
  step "3/4 跳过自动部署（NO_AUTO=1）"
  step "4/4 完成"
  cat <<EOF

$(printf '\033[1m')Git 仓库已就绪（手动部署模式）$(printf '\033[0m')

  在 Windows 上执行：
    cd D:\\workbuddy.file\\2026-09-03-13-40-36\\campus-mall
    git remote add origin ${GIT_USER}@<服务器IP>:${REPO_DIR}
    git push -u origin ${BRANCH}

  以后每次推送后，到服务器上跑一条命令即可部署：
    sudo bash ${WORK_DIR}/deploy/scripts/update.sh
EOF
  exit 0
fi

step "3/4 安装 post-receive 钩子（push 即自动部署）"
BASH_BIN="$(command -v bash)"
HOOK="$REPO_DIR/hooks/post-receive"
cat > "$HOOK" <<HOOKEOF
#!/bin/bash
# 由 setup-git.sh 生成：推送 ${BRANCH} 分支后自动检出并部署
set -u
REPO_DIR="${REPO_DIR}"
WORK_DIR="${WORK_DIR}"
BRANCH="${BRANCH}"
BASH_BIN="${BASH_BIN}"

deploy() {
  echo ""
  echo "=============================================="
  echo "  收到推送，开始自动部署"
  echo "=============================================="
  if ! git --git-dir="\$REPO_DIR" --work-tree="\$WORK_DIR" checkout -f "\$BRANCH"; then
    echo "  ✗ 检出失败，已中止（线上仍是旧版本）"
    return 1
  fi
  echo "  ✔ 代码已检出到 \$WORK_DIR"
  if [ ! -f "\$WORK_DIR/deploy/scripts/update.sh" ]; then
    echo "  ✗ 找不到 update.sh，跳过部署"
    return 1
  fi
  "\$BASH_BIN" -n "\$WORK_DIR/deploy/scripts/update.sh" || { echo "  ✗ update.sh 语法错误，已中止"; return 1; }
  sudo "\$BASH_BIN" "\$WORK_DIR/deploy/scripts/update.sh"
}

while read -r oldrev newrev ref; do
  name="\${ref#refs/heads/}"
  if [ "\$name" != "\$BRANCH" ]; then
    echo "  跳过分支 \$name（只部署 \$BRANCH）"
    continue
  fi
  deploy || echo "  ⚠ 自动部署未完成，请登录服务器手动执行： sudo bash \$WORK_DIR/deploy/scripts/update.sh"
done
HOOKEOF
chmod 755 "$HOOK"
chown "$GIT_USER:$GIT_USER" "$HOOK"
ok "钩子已安装（只对分支 $BRANCH 生效）"

step "4/4 给 $GIT_USER 放行「免密执行 update.sh」（最小权限）"
# 只放行这一个脚本，不是给完整 sudo；推送自动化必须这么配，否则钩子里 sudo 会卡在密码提示
if [ -f "$SUDOERS_FILE" ]; then
  info "已存在，覆盖更新"
fi
printf '%s ALL=(root) NOPASSWD: %s %s/deploy/scripts/update.sh\n' \
  "$GIT_USER" "$BASH_BIN" "$WORK_DIR" > "$SUDOERS_FILE"
chmod 440 "$SUDOERS_FILE"
if visudo -c -f "$SUDOERS_FILE" >/dev/null 2>&1; then
  ok "sudoers 规则已生效：$SUDOERS_FILE"
else
  rm -f "$SUDOERS_FILE"
  die "sudoers 校验失败，已回滚（不影响系统）；请把 $WORK_DIR 换成实际路径后重跑"
fi

IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
cat <<EOF

$(printf '\033[1m')完成！$(printf '\033[0m')

  裸仓库   ：${REPO_DIR}
  检出目录 ：${WORK_DIR}
  部署分支 ：${BRANCH}

$(printf '\033[1m')接下来在 Windows 上执行（只做一次）：$(printf '\033[0m')

  cd D:\\workbuddy.file\\2026-09-03-13-40-36\\campus-mall
  git remote add origin ${GIT_USER}@${IP:-<服务器IP>}:${REPO_DIR}
  git push -u origin ${BRANCH}

  推送完成后回到服务器看部署日志：
    git --git-dir=${REPO_DIR} log --oneline -1
    journalctl -u campus-mall-api -n 20
EOF
