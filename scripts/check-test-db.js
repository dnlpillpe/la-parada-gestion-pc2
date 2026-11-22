// Se ejecuta antes de "npm test": detiene el proceso, sin conectarse, si la base de pruebas no es segura.
import { resolveTestDatabaseUrl } from '../test/test-db.js';

try {
  const url = new URL(resolveTestDatabaseUrl(process.env));
  console.log(`Base de pruebas validada: ${url.hostname}:${url.port || 5432}/${url.pathname.slice(1)}`);
} catch (err) {
  console.error(`ERROR: ${err.message}`);
  process.exit(1);
}
