require('dotenv').config();
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL || 'admin@example.com';
  const password = process.env.SEED_ADMIN_PASSWORD || 'ChangeMe123!';
  const { rows } = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
  if (rows.length) {
    console.log(`admin user already exists: ${email}`);
  } else {
    const hash = await bcrypt.hash(password, 10);
    await pool.query(
      'INSERT INTO users (email, password_hash, full_name, role) VALUES ($1,$2,$3,$4)',
      [email, hash, 'مدير النظام', 'admin']
    );
    console.log(`created admin user: ${email} / ${password}`);
  }
  await pool.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
