import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import EmbeddedPostgres from 'embedded-postgres';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
process.chdir(fileURLToPath(new URL('../', import.meta.url)));
process.umask(0o077);
if (!existsSync('.env.local')) {
  const template = readFileSync('.env.example', 'utf8')
    .replace(
      'postgresql://lifeos:lifeos@localhost:5432/lifeos',
      `postgresql://lifeos:${randomBytes(24).toString('hex')}@127.0.0.1:55432/lifeos`,
    )
    .replace('replace-with-at-least-32-random-characters', randomBytes(48).toString('base64url'))
    .replace('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', randomBytes(32).toString('base64'));
  writeFileSync('.env.local', template, { mode: 0o600 });
}
chmodSync('.env.local', 0o600);
config({ path: '.env.local', quiet: true });
// Local processes must verify TLS when talking to Google.
delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
process.env.NEXT_TELEMETRY_DISABLED = '1';
const url = new URL(process.env.DATABASE_URL);
if (url.hostname !== '127.0.0.1' || url.port !== '55432' || url.pathname !== '/lifeos') {
  throw new Error(
    'Questo comando gestisce solo il database locale 127.0.0.1:55432/lifeos. Per database esterni usa npm run dev.',
  );
}
mkdirSync('.local', { recursive: true, mode: 0o700 });
const database = new EmbeddedPostgres({
  databaseDir: '.local/postgres',
  user: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password),
  port: 55432,
  persistent: true,
  authMethod: 'scram-sha-256',
  postgresFlags: ['-h', '127.0.0.1'],
  onLog: () => {},
  onError: () => {},
});
let child;
let started = false;
let stopping = false;
async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  if (child && child.exitCode === null) {
    child.kill('SIGTERM');
    await new Promise((resolve) => {
      child.once('exit', resolve);
      setTimeout(resolve, 5000).unref();
    });
  }
  if (started) await database.stop();
  process.exitCode = code;
}
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
try {
  if (!existsSync('.local/postgres/PG_VERSION')) await database.initialise();
  await database.start();
  started = true;
  const admin = new Pool({ connectionString: new URL('/postgres', url).href });
  try {
    const result = await admin.query("SELECT 1 FROM pg_database WHERE datname = 'lifeos'");
    if (!result.rowCount) await admin.query('CREATE DATABASE lifeos');
  } finally {
    await admin.end();
  }
  const pool = new Pool({ connectionString: url.href });
  try {
    await migrate(drizzle(pool), { migrationsFolder: './drizzle' });
    await pool.query('SELECT 1');
  } finally {
    await pool.end();
  }
  console.log('Database locale pronto. I dati restano in .local/postgres anche dopo la chiusura.');
  if (process.argv.includes('--check')) await stop();
  else {
    if (process.env.AUTH_GOOGLE_ID?.startsWith('your-'))
      console.log('Accesso Google da configurare: segui CONFIGURAZIONE.md.');
    const build = spawn(process.execPath, ['scripts/build-pwa.mjs'], { stdio: 'inherit' });
    const code = await new Promise((resolve) => build.once('exit', resolve));
    if (code !== 0) throw new Error('Compilazione PWA fallita');
    child = spawn(
      process.execPath,
      ['node_modules/next/dist/bin/next', 'dev', '--hostname', '127.0.0.1', '--port', '3000'],
      { stdio: 'inherit' },
    );
    console.log(
      'Apri http://localhost:3000 — lascia aperto questo terminale. Ctrl+C arresta app e database.',
    );
    child.once('exit', (code) => void stop(code ?? 0));
  }
} catch (error) {
  console.error('Avvio locale fallito:', error.code ?? error.message);
  await stop(1);
}
