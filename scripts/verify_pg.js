const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT, 10),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  max: 2
});

async function verify() {
  const res = await pool.query('SELECT user_id, nick, classe, nivel, cp FROM members ORDER BY cp DESC LIMIT 10;');
  console.log('Top members in PostgreSQL:');
  console.table(res.rows);
  await pool.end();
}

verify().catch(console.error);
