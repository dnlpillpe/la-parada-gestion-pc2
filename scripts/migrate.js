// Aplica db/schema.sql y db/seed.sql sobre DATABASE_URL (idempotente).
import { ensureMigrated, closePool } from '../lib/db.js';

await ensureMigrated();
console.log('Migración y datos demo aplicados.');
await closePool();
