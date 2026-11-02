/**
 * 数据库连接池
 * ---------------------------------------------------------------------------
 * 全项目只有这一个入口，所有 SQL 都通过 query() 执行。
 * 注意：mysql2 的 query() 返回 [行数组, 字段信息]，这里已经把字段信息丢掉，
 * 上层拿到的直接就是行数组 —— 判断「有没有查到」时用 rows.length，
 * 解构出的单行对象则用 if (!row)，不要对单行对象取 .length。
 */
require('dotenv').config();
const mysql = require('mysql2/promise');

// 数据库口令不设源码内默认值：缺失即启动失败，避免口令随代码一起公开
if (!process.env.DB_PASSWORD) {
  throw new Error('缺少环境变量 DB_PASSWORD。本地请配置 backend/.env，服务器请检查 /etc/campus-mall/api.env');
}

const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'campus',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'campus_mall',
  waitForConnections: true,
  connectionLimit: 10,
  charset: 'utf8mb4',
});

/**
 * 执行一条 SQL 并返回结果行。
 *
 * @param {string} sql 带 ? 占位符的 SQL，不要用字符串拼接防止注入
 * @param {Array} params 占位符对应的参数
 * @returns {Promise<Array>} SELECT 返回行数组，增删改返回影响行信息
 */
async function query(sql, params) {
  const result = await pool.query(sql, params || []);
  const rows = result[0];
  return rows;
}

module.exports = { pool, query };
