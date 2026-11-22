import pg from 'pg';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pool;

export function getPool() {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
    if (!connectionString) throw new Error('DATABASE_URL no está configurada');
    const local = /localhost|127\.0\.0\.1/.test(connectionString);
    pool = new pg.Pool({
      connectionString,
      ssl: local ? false : { rejectUnauthorized: true },
      max: 3,
    });
  }
  return pool;
}

export async function closePool() {
  if (pool) { await pool.end(); pool = undefined; }
}

/** Ejecuta fn dentro de una transacción con un cliente dedicado. */
export async function tx(fn) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

let migrated;
/** Aplica schema.sql y seed.sql (idempotentes) una vez por instancia, serializado con advisory lock. */
export function ensureMigrated() {
  if (!migrated) {
    migrated = (async () => {
      const schema = await readFile(path.join(root, 'db', 'schema.sql'), 'utf8');
      const seed = await readFile(path.join(root, 'db', 'seed.sql'), 'utf8');
      await tx(async (c) => {
        await c.query('SELECT pg_advisory_xact_lock(424242)');
        await c.query(schema);
        await c.query(seed);
      });
    })().catch((e) => { migrated = undefined; throw e; });
  }
  return migrated;
}
