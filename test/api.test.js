// Pruebas de integración del flujo principal contra PostgreSQL real (LPG-7..LPG-17).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, call, loginCookie } from './helpers.js';

let env; let cookie; let stallId;

before(async () => { env = await setup(); cookie = await loginCookie(env.base); });
after(async () => { await env.close(); });

test('LPG-17: escrituras sin sesión responden 401 y no escriben', async () => {
  const before = (await env.db.query('SELECT count(*)::int n FROM merchants')).rows[0].n;
  for (const [path, body] of [
    ['/api/merchants', { full_name: 'X', document: '12345678', category: 'Frutas' }],
    ['/api/requests', { stall_id: 1, description: 'x' }],
    ['/api/requests/assign-next', {}],
  ]) {
    const r = await call(env.base, path, { method: 'POST', body });
    assert.equal(r.status, 401, path);
  }
  const forged = await call(env.base, '/api/merchants', { method: 'POST', cookie: 'lp_session=eyJzdWIiOjF9.firmafalsa', body: { full_name: 'X', document: '12345679', category: 'Frutas' } });
  assert.equal(forged.status, 401, 'cookie falsificada');
  assert.equal((await env.db.query('SELECT count(*)::int n FROM merchants')).rows[0].n, before);
});

test('LPG-5: credenciales inválidas se rechazan', async () => {
  const r = await call(env.base, '/api/login', { method: 'POST', body: { username: 'operador.test', password: 'incorrecta' } });
  assert.equal(r.status, 401);
  assert.equal(r.headers.get('set-cookie'), null);
});

test('CSRF: escritura desde otro origen se rechaza con 403', async () => {
  const r = await call(env.base, '/api/merchants', { method: 'POST', cookie, headers: { Origin: 'https://atacante.example' }, body: { full_name: 'X', document: '87654321', category: 'Frutas' } });
  assert.equal(r.status, 403);
});

test('LPG-7/LPG-8: registra comerciante y puesto; rechaza duplicados', async () => {
  const m = await call(env.base, '/api/merchants', { method: 'POST', cookie, body: { full_name: 'Comerciante Prueba', document: '10999999991', category: 'Frutas' } });
  assert.equal(m.status, 201);
  assert.equal(m.data.created_by > 0, true);
  const dup = await call(env.base, '/api/merchants', { method: 'POST', cookie, body: { full_name: 'Otro', document: '10999999991', category: 'Frutas' } });
  assert.equal(dup.status, 409);
  const bad = await call(env.base, '/api/merchants', { method: 'POST', cookie, body: { full_name: 'Otro', document: '12', category: 'Frutas' } });
  assert.equal(bad.status, 400);

  const s = await call(env.base, '/api/stalls', { method: 'POST', cookie, body: { code: 'z-900', pavilion: 'Pabellón Z', merchant_id: m.data.id } });
  assert.equal(s.status, 201);
  assert.equal(s.data.code, 'Z-900');
  stallId = s.data.id;
  const dupStall = await call(env.base, '/api/stalls', { method: 'POST', cookie, body: { code: 'Z-900', pavilion: 'Pabellón Z', merchant_id: m.data.id } });
  assert.equal(dupStall.status, 409);
  const list = await call(env.base, '/api/merchants', { cookie });
  assert.ok(list.data.find((x) => x.document === '10999999991').stalls.some((st) => st.code === 'Z-900'));
});

test('LPG-9/LPG-10/LPG-12: lote con revisión sanitaria, validaciones y filtro', async () => {
  const zero = await call(env.base, '/api/lots', { method: 'POST', cookie, body: { stall_id: stallId, product: 'Papa', quantity: 0, unit: 'kg', received_on: '2026-11-21' } });
  assert.equal(zero.status, 400);
  const lot = await call(env.base, '/api/lots', { method: 'POST', cookie, body: { stall_id: stallId, product: 'Papa', quantity: 25, unit: 'saco', received_on: '2026-11-21' } });
  assert.equal(lot.status, 201);
  assert.equal(lot.data.sanitary_status, 'PENDIENTE');
  const badSt = await call(env.base, `/api/lots/${lot.data.id}/review`, { method: 'POST', cookie, body: { sanitary_status: 'TAL_VEZ' } });
  assert.equal(badSt.status, 400);
  const rev = await call(env.base, `/api/lots/${lot.data.id}/review`, { method: 'POST', cookie, body: { sanitary_status: 'RECHAZADO' } });
  assert.equal(rev.status, 200);
  assert.ok(rev.data.reviewed_by > 0 && rev.data.reviewed_at);
  const filtered = await call(env.base, '/api/lots?status=RECHAZADO', { cookie });
  assert.ok(filtered.data.length >= 1 && filtered.data.every((l) => l.sanitary_status === 'RECHAZADO'));
});

test('LPG-14: asigna el siguiente turno por orden de llegada (FIFO)', async () => {
  const r1 = await call(env.base, '/api/requests', { method: 'POST', cookie, body: { stall_id: stallId, description: 'Primera en llegar' } });
  const r2 = await call(env.base, '/api/requests', { method: 'POST', cookie, body: { stall_id: stallId, description: 'Segunda en llegar' } });
  assert.equal(r1.status, 201); assert.equal(r2.data.status, 'EN_COLA');

  const a1 = await call(env.base, '/api/requests/assign-next', { method: 'POST', cookie });
  assert.equal(a1.status, 200);
  assert.equal(a1.data.id, r1.data.id, 'se asigna primero la más antigua');
  assert.equal(a1.data.status, 'ASIGNADA');
  const a2 = await call(env.base, '/api/requests/assign-next', { method: 'POST', cookie });
  assert.equal(a2.data.id, r2.data.id);
  assert.notEqual(a1.data.porter_id, a2.data.porter_id, 'rotación de estibadores');
  const none = await call(env.base, '/api/requests/assign-next', { method: 'POST', cookie });
  assert.equal(none.status, 404);
  assert.equal(none.data.error, 'No hay solicitudes pendientes');

  // LPG-15: reasignar explícitamente una solicitud ya asignada => 409 y sin cambios.
  const dup = await call(env.base, `/api/requests/${r1.data.id}/assign`, { method: 'POST', cookie });
  assert.equal(dup.status, 409);
  const rows = (await env.db.query('SELECT count(*)::int n FROM assignments WHERE request_id = $1', [r1.data.id])).rows[0].n;
  assert.equal(rows, 1);
});

test('LPG-15: asignaciones concurrentes nunca duplican una solicitud', async () => {
  const ids = [];
  for (let i = 0; i < 3; i++) {
    ids.push((await call(env.base, '/api/requests', { method: 'POST', cookie, body: { stall_id: stallId, description: `Concurrente ${i}` } })).data.id);
  }
  const results = await Promise.all(Array.from({ length: 6 }, () => call(env.base, '/api/requests/assign-next', { method: 'POST', cookie })));
  const ok = results.filter((r) => r.status === 200).map((r) => r.data.id).sort();
  assert.deepEqual(ok, [...ids].sort(), 'cada solicitud asignada exactamente una vez');
  assert.ok(results.filter((r) => r.status !== 200).every((r) => r.status === 404));
  const dupRows = (await env.db.query('SELECT request_id FROM assignments GROUP BY request_id HAVING count(*) > 1')).rows;
  assert.equal(dupRows.length, 0);
  // Barrera en la BD: insertar manualmente una segunda asignación viola UNIQUE.
  await assert.rejects(env.db.query('INSERT INTO assignments (request_id, porter_id, assigned_by) VALUES ($1, 1, 1)', [ids[0]]), /duplicate key/);
});

test('LPG-16: historial muestra quién recibió, quién asignó y la hora; persiste', async () => {
  const h = await call(env.base, '/api/history', { cookie });
  assert.equal(h.status, 200);
  assert.ok(h.data.length >= 5);
  const first = h.data.at(-1);
  assert.equal(first.description, 'Primera en llegar');
  assert.ok(first.porter && first.badge);
  assert.equal(first.assigned_by, 'Operador de Pruebas');
  assert.ok(!Number.isNaN(Date.parse(first.assigned_at)));
  // "Recargar": una lectura independiente desde la BD devuelve lo mismo.
  const again = await call(env.base, '/api/history', { cookie });
  assert.deepEqual(again.data, h.data);
  const unauth = await call(env.base, '/api/history');
  assert.equal(unauth.status, 401, 'el historial operativo también exige sesión');
});

test('LPG-18: los datos demo ficticios existen tras la migración', async () => {
  const p = await env.db.query('SELECT count(*)::int n FROM porters');
  const m = await env.db.query("SELECT count(*)::int n FROM merchants WHERE full_name LIKE '%ficti%'");
  assert.ok(p.rows[0].n >= 3); assert.ok(m.rows[0].n >= 3);
});

test('LPG-14: asignación explícita de una solicitud en cola devuelve la solicitud asignada', async () => {
  const r = await call(env.base, '/api/requests', { method: 'POST', cookie, body: { stall_id: stallId, description: 'Explícita' } });
  const a = await call(env.base, `/api/requests/${r.data.id}/assign`, { method: 'POST', cookie });
  assert.equal(a.status, 200);
  assert.equal(a.data.id, r.data.id);
  assert.equal(a.data.status, 'ASIGNADA');
});

test('LPG-14: asignar por ID la segunda solicitud se rechaza y respeta el orden de llegada', async () => {
  const pendientes = async () => (await env.db.query(`SELECT count(*)::int n FROM stowage_requests WHERE status = 'EN_COLA'`)).rows[0].n;
  assert.equal(await pendientes(), 0, 'la cola parte vacía');
  const r1 = await call(env.base, '/api/requests', { method: 'POST', cookie, body: { stall_id: stallId, description: 'Llega primero (FIFO por ID)' } });
  const r2 = await call(env.base, '/api/requests', { method: 'POST', cookie, body: { stall_id: stallId, description: 'Llega segundo (FIFO por ID)' } });

  const salto = await call(env.base, `/api/requests/${r2.data.id}/assign`, { method: 'POST', cookie });
  assert.equal(salto.status, 409);
  assert.match(salto.data.error, /orden de llegada/);
  const estados = (await env.db.query('SELECT id, status, porter_id FROM stowage_requests WHERE id = ANY($1) ORDER BY id', [[r1.data.id, r2.data.id]])).rows;
  assert.deepEqual(estados.map((e) => e.status), ['EN_COLA', 'EN_COLA'], 'ambas siguen pendientes');
  assert.ok(estados.every((e) => e.porter_id === null));
  const asignaciones = (await env.db.query('SELECT count(*)::int n FROM assignments WHERE request_id = ANY($1)', [[r1.data.id, r2.data.id]])).rows[0].n;
  assert.equal(asignaciones, 0, 'no se registró ninguna asignación');

  // El flujo normal asigna primero la más antigua y luego la siguiente.
  const a1 = await call(env.base, '/api/requests/assign-next', { method: 'POST', cookie });
  assert.equal(a1.data.id, r1.data.id);
  const a2 = await call(env.base, `/api/requests/${r2.data.id}/assign`, { method: 'POST', cookie });
  assert.equal(a2.status, 200, 'cuando ya es la más antigua, la asignación por ID procede');
  assert.equal(a2.data.id, r2.data.id);
});
