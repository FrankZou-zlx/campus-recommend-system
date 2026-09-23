/**
 * 由 backend/sql/schema.sql 生成容器初始化脚本 deploy/mysql/init.sql
 * （schema.sql 改动后重新执行一次：node deploy/scripts/gen-init-sql.js）
 *
 * 为什么需要：MySQL 官方镜像在「数据卷为空」的首次启动时，
 * 会自动执行 /docker-entrypoint-initdb.d/ 下的 .sql，从而完成建库建表。
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const src = path.join(root, 'backend', 'sql', 'schema.sql');
const out = path.join(root, 'deploy', 'mysql', 'init.sql');

const schema = fs.readFileSync(src, 'utf8');
const header = `-- ============================================================
--  自动生成，请勿手改：源文件是 backend/sql/schema.sql
--  重新生成：node deploy/scripts/gen-init-sql.js
--  作用：MySQL 容器首次启动（数据卷为空）时自动建库建表
--  演示数据（120 用户 + 商品 + 行为）由 backend/sql/seed.js 灌入
-- ============================================================
CREATE DATABASE IF NOT EXISTS \`campus_mall\`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE \`campus_mall\`;

`;

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, header + schema);
console.log('已生成 ' + path.relative(root, out) + '（' + (header + schema).length + ' 字节）');
