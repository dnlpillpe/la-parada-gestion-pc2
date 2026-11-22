// Reglas de negocio de La Parada. Todas las consultas son parametrizadas.
import { getPool, tx } from './db.js';

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const UNITS = ['kg', 't', 'saco', 'caja', 'jaba'];
export const SANITARY = ['PENDIENTE', 'APROBADO', 'OBSERVADO', 'RECHAZADO'];

function text(v, field, max = 120) {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s) throw new HttpError(400, `El campo "${field}" es obligatorio`);
  if (s.length > max) throw new HttpError(400, `El campo "${field}" excede ${max} caracteres`);
  return s;
}
function id(v, field) {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, `El campo "${field}" no es válido`);
  return n;
}
function unique(err, msg) {
  if (err.code === '23505') throw new HttpError(409, msg);
  if (err.code === '23503') throw new HttpError(400, 'La referencia indicada no existe');
  throw err;
}

// ---------- E1 Comerciantes y puestos (LPG-7, LPG-8, LPG-11) ----------
export async function createMerchant(body, operatorId) {
  const full_name = text(body.full_name, 'nombre');
  const document = text(body.document, 'documento', 11);
  if (!/^\d{8}(\d{3})?$/.test(document)) throw new HttpError(400, 'El documento debe ser DNI (8) o RUC (11) dígitos');
  const category = text(body.category, 'rubro', 60);
  try {
    const { rows } = await getPool().query(
      `INSERT INTO merchants (full_name, document, category, created_by) VALUES ($1,$2,$3,$4) RETURNING *`,
      [full_name, document, category, operatorId]);
    return rows[0];
  } catch (e) { return unique(e, 'Ya existe un comerciante con ese documento'); }
}

export async function createStall(body, operatorId) {
  const code = text(body.code, 'código', 20).toUpperCase();
  const pavilion = text(body.pavilion, 'pabellón', 60);
  const merchant_id = id(body.merchant_id, 'comerciante');
  try {
    const { rows } = await getPool().query(
      `INSERT INTO stalls (code, pavilion, merchant_id, created_by) VALUES ($1,$2,$3,$4) RETURNING *`,
      [code, pavilion, merchant_id, operatorId]);
    return rows[0];
  } catch (e) { return unique(e, 'Ya existe un puesto con ese código'); }
}

export async function listMerchants() {
  const { rows } = await getPool().query(`
    SELECT m.id, m.full_name, m.document, m.category, m.created_at,
           COALESCE(json_agg(json_build_object('id', s.id, 'code', s.code, 'pavilion', s.pavilion)
                    ORDER BY s.code) FILTER (WHERE s.id IS NOT NULL), '[]') AS stalls
    FROM merchants m LEFT JOIN stalls s ON s.merchant_id = m.id
    GROUP BY m.id ORDER BY m.id`);
  return rows;
}

export async function listStalls() {
  const { rows } = await getPool().query(`
    SELECT s.id, s.code, s.pavilion, m.full_name AS merchant
    FROM stalls s JOIN merchants m ON m.id = s.merchant_id ORDER BY s.code`);
  return rows;
}

// ---------- E2 Lotes y revisión sanitaria (LPG-9, LPG-10, LPG-12) ----------
export async function createLot(body, operatorId) {
  const stall_id = id(body.stall_id, 'puesto');
  const product = text(body.product, 'producto', 80);
  const quantity = Number(body.quantity);
  if (!Number.isFinite(quantity) || quantity <= 0) throw new HttpError(400, 'La cantidad debe ser mayor que 0');
  const unit = text(body.unit, 'unidad', 10);
  if (!UNITS.includes(unit)) throw new HttpError(400, `Unidad no válida (${UNITS.join(', ')})`);
  const received_on = text(body.received_on, 'fecha', 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(received_on)) throw new HttpError(400, 'Fecha no válida (AAAA-MM-DD)');
  const status = body.sanitary_status ? String(body.sanitary_status) : 'PENDIENTE';
  if (!SANITARY.includes(status)) throw new HttpError(400, 'Estado sanitario no válido');
  try {
    const { rows } = await getPool().query(
      `INSERT INTO lots (stall_id, product, quantity, unit, received_on, sanitary_status, created_by,
                         reviewed_by, reviewed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7, CASE WHEN $6 <> 'PENDIENTE' THEN $7::int END,
               CASE WHEN $6 <> 'PENDIENTE' THEN now() END) RETURNING *`,
      [stall_id, product, quantity, unit, received_on, status, operatorId]);
    return rows[0];
  } catch (e) { return unique(e, 'Lote duplicado'); }
}

export async function reviewLot(lotId, body, operatorId) {
  const status = String(body.sanitary_status || '');
  if (!SANITARY.includes(status)) throw new HttpError(400, 'Estado sanitario no válido');
  const { rows } = await getPool().query(
    `UPDATE lots SET sanitary_status = $1, reviewed_by = $2, reviewed_at = now() WHERE id = $3 RETURNING *`,
    [status, operatorId, id(lotId, 'lote')]);
  if (!rows[0]) throw new HttpError(404, 'Lote no encontrado');
  return rows[0];
}

export async function listLots(status) {
  if (status && !SANITARY.includes(status)) throw new HttpError(400, 'Estado sanitario no válido');
  const { rows } = await getPool().query(`
    SELECT l.id, l.product, l.quantity, l.unit, to_char(l.received_on,'YYYY-MM-DD') AS received_on,
           l.sanitary_status, l.reviewed_at, s.code AS stall, m.full_name AS merchant, o.full_name AS reviewed_by
    FROM lots l JOIN stalls s ON s.id = l.stall_id JOIN merchants m ON m.id = s.merchant_id
    LEFT JOIN operators o ON o.id = l.reviewed_by
    WHERE ($1::text IS NULL OR l.sanitary_status = $1)
    ORDER BY l.id DESC`, [status || null]);
  return rows;
}

// ---------- E3 Turnos de estibaje (LPG-13, LPG-14, LPG-15) ----------
export async function createRequest(body, operatorId) {
  const stall_id = id(body.stall_id, 'puesto');
  const description = text(body.description, 'descripción', 160);
  try {
    const { rows } = await getPool().query(
      `INSERT INTO stowage_requests (stall_id, description, created_by) VALUES ($1,$2,$3) RETURNING *`,
      [stall_id, description, operatorId]);
    return rows[0];
  } catch (e) { return unique(e, 'Solicitud duplicada'); }
}

/**
 * Asigna una solicitud a un estibador dentro de una transacción.
 * - requestId nulo => toma la solicitud EN_COLA más antigua (FIFO) con FOR UPDATE SKIP LOCKED.
 * - requestId dado => bloquea esa fila; responde 409 si ya no está EN_COLA o si hay una solicitud más antigua en cola.
 * El estibador es el que lleva más tiempo sin turno (rotación equitativa).
 * La restricción UNIQUE(assignments.request_id) impide un segundo registro aunque fallara lo anterior.
 */
export async function assign(operatorId, requestId = null) {
  return tx(async (c) => {
    let req;
    if (requestId == null) {
      ({ rows: [req] } = await c.query(
        `SELECT * FROM stowage_requests WHERE status = 'EN_COLA'
         ORDER BY arrived_at, id LIMIT 1 FOR UPDATE SKIP LOCKED`));
      if (!req) throw new HttpError(404, 'No hay solicitudes pendientes');
    } else {
      ({ rows: [req] } = await c.query(`SELECT * FROM stowage_requests WHERE id = $1 FOR UPDATE`, [id(requestId, 'solicitud')]));
      if (!req) throw new HttpError(404, 'Solicitud no encontrada');
      if (req.status !== 'EN_COLA') throw new HttpError(409, 'La solicitud ya fue asignada');
      // Orden de llegada: solo se puede asignar por ID la solicitud más antigua en cola.
      const { rows: [older] } = await c.query(
        `SELECT id FROM stowage_requests
         WHERE status = 'EN_COLA' AND (arrived_at, id) < ($1, $2)
         ORDER BY arrived_at, id LIMIT 1`, [req.arrived_at, req.id]);
      if (older) {
        throw new HttpError(409, `No respeta el orden de llegada: la solicitud #${older.id} llegó antes y sigue en cola`);
      }
    }
    const { rows: [porter] } = await c.query(
      `SELECT * FROM porters WHERE active ORDER BY last_assigned_at NULLS FIRST, id LIMIT 1 FOR UPDATE`);
    if (!porter) throw new HttpError(409, 'No hay estibadores disponibles');

    const upd = await c.query(
      `UPDATE stowage_requests SET status = 'ASIGNADA', porter_id = $1, assigned_by = $2, assigned_at = now()
       WHERE id = $3 AND status = 'EN_COLA' RETURNING *`, [porter.id, operatorId, req.id]);
    if (upd.rowCount !== 1) throw new HttpError(409, 'La solicitud ya fue asignada');
    await c.query(`UPDATE porters SET last_assigned_at = now() WHERE id = $1`, [porter.id]);
    try {
      await c.query(`INSERT INTO assignments (request_id, porter_id, assigned_by) VALUES ($1,$2,$3)`,
        [req.id, porter.id, operatorId]);
    } catch (e) { return unique(e, 'La solicitud ya fue asignada'); }
    return { ...upd.rows[0], porter_name: porter.full_name, porter_badge: porter.badge };
  });
}

export async function listRequests() {
  const { rows } = await getPool().query(`
    SELECT r.id, r.description, r.status, r.arrived_at, r.assigned_at, s.code AS stall,
           p.full_name AS porter, o.full_name AS assigned_by
    FROM stowage_requests r JOIN stalls s ON s.id = r.stall_id
    LEFT JOIN porters p ON p.id = r.porter_id LEFT JOIN operators o ON o.id = r.assigned_by
    ORDER BY (r.status = 'EN_COLA') DESC, r.arrived_at, r.id`);
  return rows;
}

// ---------- E4 Seguimiento operativo (LPG-16) ----------
export async function history() {
  const { rows } = await getPool().query(`
    SELECT a.id, a.request_id, r.description, s.code AS stall, p.full_name AS porter, p.badge,
           o.full_name AS assigned_by, a.assigned_at, r.arrived_at
    FROM assignments a JOIN stowage_requests r ON r.id = a.request_id
    JOIN stalls s ON s.id = r.stall_id JOIN porters p ON p.id = a.porter_id
    JOIN operators o ON o.id = a.assigned_by
    ORDER BY a.assigned_at DESC, a.id DESC`);
  return rows;
}

export async function listPorters() {
  const { rows } = await getPool().query(`SELECT id, full_name, badge, active, last_assigned_at FROM porters ORDER BY id`);
  return rows;
}
