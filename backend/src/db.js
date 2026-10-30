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
  charset: 'utf8mb4'
});

// 统一查询助手：返回 [rows, fields]
async function query(sql, params) {
  const [rows] = await pool.query(sql, params || []);
  return rows;
}

module.exports = { pool, query };
