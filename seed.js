require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false
});

const classes = [
  'Nursery 1','Nursery 2','Kindergarten 1','Kindergarten 2',
  'Primary 1','Primary 2','Primary 3','Primary 4','Primary 5','Primary 6',
  'JS1','JS2','JS3','SS1','SS2','SS3'
];

(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (let i = 0; i < classes.length; i++) {
      await client.query(
        `INSERT INTO classes(name, sort_order) VALUES($1,$2)
         ON CONFLICT(name) DO UPDATE SET sort_order=EXCLUDED.sort_order`,
        [classes[i], i + 1]
      );
    }

    const ownerHash = await bcrypt.hash('owner2026', 12);
    await client.query(
      `INSERT INTO users(username,password_hash,role,class_id)
       VALUES('owner',$1,'owner',NULL)
       ON CONFLICT(username) DO NOTHING`,
      [ownerHash]
    );

    for (const className of classes) {
      const classRow = await client.query('SELECT id FROM classes WHERE name=$1', [className]);
      const hash = await bcrypt.hash(className, 12);
      await client.query(
        `INSERT INTO users(username,password_hash,role,class_id)
         VALUES($1,$2,'teacher',$3)
         ON CONFLICT(username) DO NOTHING`,
        [className, hash, classRow.rows[0].id]
      );
    }

    await client.query('COMMIT');
    console.log('Database seed complete.');
    console.log('Initial owner login: owner / owner2026');
    console.log('Initial teacher passwords are the class names. Change them before real use.');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();