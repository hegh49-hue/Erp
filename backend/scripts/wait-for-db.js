require('dotenv').config();
const { Pool } = require('pg');

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  for (let i = 0; i < 30; i++) {
    try {
      await pool.query('SELECT 1');
      await pool.end();
      console.log('database is ready');
      return;
    } catch (err) {
      console.log('waiting for database...');
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  console.error('database not reachable after 60s');
  process.exit(1);
}
main();
