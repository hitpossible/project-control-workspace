// Apply db/migrations/*.sql in order (tracked in schema_migrations).
// Usage: npm run db:migrate            apply pending migrations
//        npm run db:reset              DROP + CREATE the database, migrate, seed demo data
import { config } from 'dotenv';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import mysql from 'mysql2/promise';

config({ path: '.env.local' });

async function main() {
  const reset = process.argv.includes('--reset');
  const url = new URL(process.env.DATABASE_URL ?? '');
  const database = decodeURIComponent(url.pathname.slice(1));
  if (!database) throw new Error('DATABASE_URL must include a database name');
  if (reset && process.env.NODE_ENV === 'production' && !process.argv.includes('--force')) {
    throw new Error('Refusing to reset a production database (pass --force if you really mean it)');
  }

  const server = await mysql.createConnection({
    host: url.hostname, port: Number(url.port || 3306), user: decodeURIComponent(url.username), password: decodeURIComponent(url.password),
    multipleStatements: true, charset: 'utf8mb4_unicode_ci',
  });
  if (reset) {
    await server.query(`DROP DATABASE IF EXISTS \`${database}\``);
    console.log(`✓ dropped ${database}`);
  }
  await server.query(`CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await server.query(`USE \`${database}\``);
  await server.query("SET time_zone = '+00:00'");
  await server.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name VARCHAR(191) NOT NULL PRIMARY KEY, applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  const [done] = await server.query('SELECT name FROM schema_migrations');
  const applied = new Set((done as { name: string }[]).map((r) => r.name));
  const dir = join(process.cwd(), 'db', 'migrations');
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    if (applied.has(file)) continue;
    await server.query(readFileSync(join(dir, file), 'utf8'));
    await server.query('INSERT INTO schema_migrations(name) VALUES (?)', [file]);
    console.log(`✓ ${file}`);
  }
  const [v] = await server.query('SELECT VERSION() v');
  console.log(`✓ ${database} up to date (MySQL ${(v as { v: string }[])[0].v})`);
  await server.end();
}

main().catch((e) => {
  console.error('✗', e.message ?? e);
  process.exit(1);
});
