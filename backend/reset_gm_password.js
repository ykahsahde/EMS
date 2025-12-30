const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

const pool = new Pool({
  host: 'localhost',
  port: 5432,
  user: 'raymond_admin',
  password: 'Raymond@2024Secure',
  database: 'raymond_attendance'
});

async function resetPassword() {
  try {
    const hash = await bcrypt.hash('Gm@12345', 12);
    console.log('Generated hash:', hash);
    
    const result = await pool.query(
      'UPDATE users SET password_hash = $1 WHERE email = $2 RETURNING email, password_hash',
      [hash, 'gm@raymond.com']
    );
    
    console.log('Updated:', result.rows[0]);
    
    // Verify the password works
    const user = await pool.query('SELECT password_hash FROM users WHERE email = $1', ['gm@raymond.com']);
    const isValid = await bcrypt.compare('Gm@12345', user.rows[0].password_hash);
    console.log('Password verification:', isValid ? 'SUCCESS' : 'FAILED');
    
    await pool.end();
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

resetPassword();
