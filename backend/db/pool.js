const { Pool } = require('pg');

const useDatabaseSSL = process.env.DATABASE_SSL === 'true' || process.env.DATABASE_SSL === '1';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: useDatabaseSSL ? { rejectUnauthorized: false } : false
});

pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL pool error:', err.message);
});

module.exports = pool;
