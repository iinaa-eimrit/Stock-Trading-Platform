import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { Pool } from 'pg';

const pool = new Pool({ 
  connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/postgres' 
});

async function runMigrations() {
  const client = await pool.connect();
  try {
    // 1. Ensure migrations table exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version VARCHAR(255) PRIMARY KEY,
        applied_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        checksum VARCHAR(255) NOT NULL
      );
    `);

    // 2. Find migration files
    const migrationsDir = path.join(__dirname, 'migrations');
    if (!fs.existsSync(migrationsDir)) {
      console.log('No migrations directory found.');
      return;
    }

    const files = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();

    // 3. Apply missing migrations
    for (const file of files) {
      const version = path.parse(file).name;
      const filePath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(filePath, 'utf8');
      
      const checksum = crypto.createHash('sha256').update(sql).digest('hex');

      const { rows } = await client.query('SELECT checksum FROM schema_migrations WHERE version = $1', [version]);
      
      if (rows.length > 0) {
        if (rows[0].checksum !== checksum) {
          throw new Error(`Migration ${version} checksum mismatch! Database has ${rows[0].checksum}, but file is ${checksum}`);
        }
        console.log(`Migration ${version} already applied.`);
        continue;
      }

      console.log(`Applying migration ${version}...`);
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)',
          [version, checksum]
        );
        await client.query('COMMIT');
        console.log(`Migration ${version} applied successfully.`);
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`Migration ${version} failed!`);
        throw err;
      }
    }
    
    console.log('All migrations applied successfully.');
  } finally {
    client.release();
    await pool.end();
  }
}

// Run if executed directly
if (require.main === module) {
  runMigrations().catch(err => {
    console.error('Fatal error during migrations:', err);
    process.exit(1);
  });
}
