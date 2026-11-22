// Pruebas unitarias de autenticación (LPG-5, LPG-17).
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.SESSION_SECRET = 'secreto-solo-para-pruebas-unitarias';
const auth = await import('../lib/auth.js');

test('hashPassword/verifyPassword: acepta la clave correcta y rechaza otra', () => {
  const h = auth.hashPassword('mi-clave');
  assert.match(h, /^scrypt\$16384\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
  assert.equal(auth.verifyPassword('mi-clave', h), true);
  assert.equal(auth.verifyPassword('otra-clave', h), false);
});

test('token de sesión: válido se verifica; alterado o vencido se rechaza', async () => {
  const token = await auth.createSessionToken({ id: 7, full_name: 'Op', username: 'op' });
  const ok = await auth.verifySessionToken(token);
  assert.equal(ok.sub, 7);

  const [payload, sig] = token.split('.');
  const forged = Buffer.from(JSON.stringify({ sub: 1, exp: Date.now() + 1e9 })).toString('base64url');
  assert.equal(await auth.verifySessionToken(`${forged}.${sig}`), null, 'payload alterado');
  assert.equal(await auth.verifySessionToken(`${payload}.xxxx`), null, 'firma alterada');
  assert.equal(await auth.verifySessionToken('basura'), null);

  const crypto = await import('node:crypto');
  const expiredPayload = Buffer.from(JSON.stringify({ sub: 7, exp: Date.now() - 1000 })).toString('base64url');
  const expiredSig = crypto.createHmac('sha256', process.env.SESSION_SECRET).update(expiredPayload).digest('base64url');
  assert.equal(await auth.verifySessionToken(`${expiredPayload}.${expiredSig}`), null, 'token vencido');
});

test('cookie de sesión es HttpOnly, SameSite=Strict y Secure', () => {
  const c = auth.sessionCookie('abc');
  assert.match(c, /HttpOnly/); assert.match(c, /SameSite=Strict/); assert.match(c, /Secure/);
});
