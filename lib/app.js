// Router HTTP único: lo usa la función serverless de Vercel (api/index.js) y el servidor local (server.js).
import { ensureMigrated } from './db.js';
import * as auth from './auth.js';
import * as svc from './service.js';

const MAX_BODY = 16 * 1024;

function send(res, status, data, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(data));
}

async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body; // Vercel ya parseó el cuerpo
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > MAX_BODY) throw new svc.HttpError(413, 'Cuerpo demasiado grande');
  }
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { throw new svc.HttpError(400, 'JSON no válido'); }
}

/** Autorización en servidor (LPG-17): toda escritura exige sesión válida firmada. */
async function requireOperator(req) {
  const session = await auth.verifySessionToken(auth.readCookie(req));
  if (!session) throw new svc.HttpError(401, 'Debe iniciar sesión como operador');
  return session;
}

/** Defensa CSRF adicional a SameSite=Strict: las escrituras deben venir del mismo origen. */
function checkOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return;
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  if (new URL(origin).host !== host) throw new svc.HttpError(403, 'Origen no permitido');
}

const reply = (status, data, headers) => ({ __reply: true, status, data, headers });

const routes = [
  ['GET', /^\/api\/health$/, async () => ({ ok: true, service: 'la-parada', time: new Date().toISOString() })],
  ['POST', /^\/api\/login$/, async (req, res) => {
    const body = await readJson(req);
    const op = await auth.login(String(body.username || ''), String(body.password || ''));
    if (!op) throw new svc.HttpError(401, 'Credenciales inválidas');
    const token = await auth.createSessionToken(op);
    const secure = process.env.NODE_ENV === 'production' || !!process.env.VERCEL;
    return reply(200, { id: op.id, full_name: op.full_name, username: op.username }, { 'Set-Cookie': auth.sessionCookie(token, { secure }) });
  }, { public: true }],
  ['POST', /^\/api\/logout$/, async () => reply(200, { ok: true }, { 'Set-Cookie': auth.clearCookie() }), { public: true }],
  ['GET', /^\/api\/me$/, async (req, _res, s) => ({ id: s.sub, full_name: s.name, username: s.user })],
  ['GET', /^\/api\/merchants$/, () => svc.listMerchants()],
  ['POST', /^\/api\/merchants$/, async (req, _r, s) => reply(201, await svc.createMerchant(await readJson(req), s.sub))],
  ['GET', /^\/api\/stalls$/, () => svc.listStalls()],
  ['POST', /^\/api\/stalls$/, async (req, _r, s) => reply(201, await svc.createStall(await readJson(req), s.sub))],
  ['GET', /^\/api\/lots$/, (req) => svc.listLots(new URL(req.url, 'http://x').searchParams.get('status'))],
  ['POST', /^\/api\/lots$/, async (req, _r, s) => reply(201, await svc.createLot(await readJson(req), s.sub))],
  ['POST', /^\/api\/lots\/(\d+)\/review$/, async (req, _r, s, m) => svc.reviewLot(m[1], await readJson(req), s.sub)],
  ['GET', /^\/api\/porters$/, () => svc.listPorters()],
  ['GET', /^\/api\/requests$/, () => svc.listRequests()],
  ['POST', /^\/api\/requests$/, async (req, _r, s) => reply(201, await svc.createRequest(await readJson(req), s.sub))],
  ['POST', /^\/api\/requests\/assign-next$/, async (_q, _r, s) => reply(200, await svc.assign(s.sub))],
  ['POST', /^\/api\/requests\/(\d+)\/assign$/, async (_q, _r, s, m) => reply(200, await svc.assign(s.sub, m[1]))],
  ['GET', /^\/api\/history$/, () => svc.history()],
];

export default async function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname.replace(/\/+$/, '') || '/';
  try {
    const match = routes.map(([method, re, fn, opts]) => ({ method, m: pathname.match(re), fn, opts: opts || {} }))
      .filter((r) => r.m);
    if (!match.length) return send(res, 404, { error: 'Ruta no encontrada' });
    const route = match.find((r) => r.method === req.method);
    if (!route) return send(res, 405, { error: 'Método no permitido' });
    if (pathname !== '/api/health') await ensureMigrated();
    if (req.method !== 'GET') checkOrigin(req);
    // Lecturas y escrituras de la operación requieren operador autenticado; solo login/logout/health son públicos.
    const session = route.opts.public || pathname === '/api/health' ? null : await requireOperator(req);
    const out = await route.fn(req, res, session, route.m);
    if (out && out.__reply) return send(res, out.status, out.data, out.headers);
    return send(res, 200, out);
  } catch (err) {
    if (err instanceof svc.HttpError) return send(res, err.status, { error: err.message });
    console.error('[api]', err);
    return send(res, 500, { error: 'Error interno' });
  }
}
