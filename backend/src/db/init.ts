import { query } from './db';
import * as fs from 'fs';
import * as path from 'path';

async function init() {
  const schemaPath = path.join(__dirname, 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf8');
  await query(schema);
  console.log('Database initialized successfully.');
  process.exit(0);
}

init().catch(err => {
  console.error(err);
  process.exit(1);
});
