require('dotenv').config();
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'campus',
  password: process.env.DB_PASSWORD || 'campus1234',
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
