// Resolución segura de la base de pruebas. Las pruebas borran y recrean el esquema public,
// por eso solo se aceptan bases dedicadas y desechables, nunca DATABASE_URL.
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', 'postgres']);

export class UnsafeTestDatabaseError extends Error {}

/**
 * Devuelve la URL de la base de pruebas o lanza un error ANTES de abrir cualquier conexión.
 * Reglas:
 *  1. TEST_DATABASE_URL es obligatoria (no hay valor por defecto ni se usa DATABASE_URL).
 *  2. No puede coincidir con DATABASE_URL.
 *  3. El nombre de la base debe terminar en "_test".
 *  4. El host debe ser local (localhost, 127.0.0.1, ::1 o el servicio "postgres" de CI).
 */
export function resolveTestDatabaseUrl(env = process.env) {
  const raw = env.TEST_DATABASE_URL;
  if (!raw || !raw.trim()) {
    throw new UnsafeTestDatabaseError(
      'TEST_DATABASE_URL no está definida. Las pruebas requieren una base PostgreSQL dedicada y desechable ' +
      '(por ejemplo postgres://postgres:postgres@localhost:55432/laparada_test). No se usará DATABASE_URL.');
  }
  let url;
  try { url = new URL(raw); } catch {
    throw new UnsafeTestDatabaseError('TEST_DATABASE_URL no es una URL válida.');
  }
  if (!/^postgres(ql)?:$/.test(url.protocol)) {
    throw new UnsafeTestDatabaseError('TEST_DATABASE_URL debe usar el protocolo postgres://');
  }
  if (env.DATABASE_URL && env.DATABASE_URL.trim() === raw.trim()) {
    throw new UnsafeTestDatabaseError('TEST_DATABASE_URL no puede ser igual a DATABASE_URL.');
  }
  const dbName = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!/_test$/.test(dbName)) {
    throw new UnsafeTestDatabaseError(`La base de pruebas debe terminar en "_test" (recibido: "${dbName || '(vacío)'}").`);
  }
  if (!LOCAL_HOSTS.has(url.hostname)) {
    throw new UnsafeTestDatabaseError(`La base de pruebas debe ser local (recibido host: "${url.hostname}").`);
  }
  return raw;
}
