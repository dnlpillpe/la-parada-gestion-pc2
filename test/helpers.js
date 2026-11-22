// Utilidades de prueba: base PostgreSQL limpia + servidor HTTP real en puerto aleatorio.
// La base se valida con resolveTestDatabaseUrl() antes de crear el pool o ejecutar SQL.
import { getPool, ensureMigrated, closePool } from '../lib/db.js';
import { hashPassword } from '../lib/auth.js';
import { createServer } from '../scripts/dev-server.js';
import { resolveTestDatabaseUrl } from './test-db.js';

export const TEST_USER = 'operador.test';
export const TEST_PASS = 'clave-de-prueba-solo-ci';

export async function setup() {
  // Lanza un error, sin conectarse, si falta TEST_DATABASE_URL o si el destino no es una base de pruebas local.
  const testUrl = resolveTestDatabaseUrl(process.env);
  process.env.DATABASE_URL = testUrl; // lib/db.js lee DATABASE_URL: se fuerza a la base de pruebas validada.
  const db = getPool();
  await db.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
  await ensureMigrated();
  await db.query('INSERT INTO operators (username, full_name, password_hash) VALUES ($1,$2,$3)',
    [TEST_USER, 'Operador de Pruebas', hashPassword(TEST_PASS)]);
  const server = createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    db, base,
    async close() { await new Promise((r) => server.close(r)); await closePool(); },
  };
}

export async function call(base, path, { method = 'GET', body, cookie, headers = {} } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data, headers: res.headers };
}

export async function loginCookie(base, username = TEST_USER, password = TEST_PASS) {
  const r = await call(base, '/api/login', { method: 'POST', body: { username, password } });
  if (r.status !== 200) throw new Error('login falló ' + r.status);
  return r.headers.get('set-cookie').split(';')[0];
}
