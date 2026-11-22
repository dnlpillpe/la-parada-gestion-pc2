import crypto from 'node:crypto';
import { getPool } from './db.js';

const SESSION_HOURS = 8;
export const COOKIE = 'lp_session';

/** Hash de contraseña con scrypt (sin dependencias externas). Formato: scrypt$N$salt$hash */
export function hashPassword(password, N = 16384) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64, { N, r: 8, p: 1 });
  return `scrypt$${N}$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(password, stored) {
  const [alg, n, saltHex, hashHex] = String(stored).split('$');
  if (alg !== 'scrypt') return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length, { N: Number(n), r: 8, p: 1 });
  return crypto.timingSafeEqual(actual, expected);
}

let cachedKey;
/** Clave HMAC: SESSION_SECRET si existe; si no, una clave aleatoria guardada en la BD en el primer arranque. */
export async function signingKey() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  if (cachedKey) return cachedKey;
  const db = getPool();
  await db.query(
    `INSERT INTO app_config (key, value) VALUES ('session_key', $1) ON CONFLICT (key) DO NOTHING`,
    [crypto.randomBytes(32).toString('hex')],
  );
  const { rows } = await db.query(`SELECT value FROM app_config WHERE key = 'session_key'`);
  cachedKey = rows[0].value;
  return cachedKey;
}

const b64 = (s) => Buffer.from(s).toString('base64url');

export async function createSessionToken(operator) {
  const payload = b64(JSON.stringify({
    sub: operator.id, name: operator.full_name, user: operator.username,
    exp: Date.now() + SESSION_HOURS * 3600 * 1000,
  }));
  const sig = crypto.createHmac('sha256', await signingKey()).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export async function verifySessionToken(token) {
  if (!token || !token.includes('.')) return null;
  const [payload, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', await signingKey()).update(payload).digest('base64url');
  const a = Buffer.from(sig); const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (typeof data.exp !== 'number' || data.exp < Date.now()) return null;
    return data;
  } catch { return null; }
}

export function sessionCookie(token, { secure = true } = {}) {
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_HOURS * 3600}${secure ? '; Secure' : ''}`;
}

export function clearCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;
}

export function readCookie(req, name = COOKIE) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

export async function login(username, password) {
  const { rows } = await getPool().query('SELECT * FROM operators WHERE username = $1', [username]);
  const op = rows[0];
  // Se verifica siempre un hash para no revelar por tiempo si el usuario existe.
  const ok = verifyPassword(password, op ? op.password_hash : DUMMY_HASH);
  return ok && op ? op : null;
}

const DUMMY_HASH = hashPassword('dummy-password');
