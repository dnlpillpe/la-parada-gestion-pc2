// Pruebas del aislamiento de la base de pruebas: nunca se debe tocar una base que no sea de pruebas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { resolveTestDatabaseUrl } from './test-db.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROD_LIKE = 'postgres://usuario:secreto@203.0.113.10:5432/produccion';

test('Aislamiento: exige TEST_DATABASE_URL y rechaza destinos que no son de prueba', () => {
  assert.throws(() => resolveTestDatabaseUrl({ DATABASE_URL: PROD_LIKE }), /TEST_DATABASE_URL no está definida/);
  assert.throws(() => resolveTestDatabaseUrl({ TEST_DATABASE_URL: 'postgres://u:p@localhost:5432/laparada' }), /terminar en "_test"/);
  assert.throws(() => resolveTestDatabaseUrl({ TEST_DATABASE_URL: 'postgres://u:p@db.ejemplo.com:5432/laparada_test' }), /debe ser local/);
  const same = 'postgres://u:p@localhost:5432/laparada_test';
  assert.throws(() => resolveTestDatabaseUrl({ TEST_DATABASE_URL: same, DATABASE_URL: same }), /igual a DATABASE_URL/);
  assert.equal(resolveTestDatabaseUrl({ TEST_DATABASE_URL: same }), same);
});

test('Aislamiento: sin TEST_DATABASE_URL el proceso se detiene sin intentar conectarse', () => {
  // El hijo intercepta Pool.connect/Pool.query: si setup() intentara conectarse, escribiría INTENTO_CONEXION.
  const script = `
    import pg from 'pg';
    for (const m of ['connect', 'query']) {
      const original = pg.Pool.prototype[m];
      pg.Pool.prototype[m] = function (...args) { process.stderr.write('INTENTO_CONEXION\\n'); return original.apply(this, args); };
    }
    const { setup } = await import('./test/helpers.js');
    await setup();
  `;
  const env = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, DATABASE_URL: PROD_LIKE };
  const started = Date.now();
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd: root, env, encoding: 'utf8', timeout: 20000 });
  const elapsed = Date.now() - started;
  assert.notEqual(r.status, 0, 'el proceso debe terminar con error');
  assert.match(r.stderr, /TEST_DATABASE_URL no está definida/);
  assert.doesNotMatch(r.stderr, /INTENTO_CONEXION/, 'no debe intentar conectarse');
  assert.ok(elapsed < 10000, `debe fallar rápido (tardó ${elapsed} ms)`);
});
