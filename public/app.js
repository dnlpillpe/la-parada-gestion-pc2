// Cliente de La Parada: sin dependencias, todo el texto dinámico se inserta con textContent (sin innerHTML con datos).
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

async function api(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `Error ${res.status}`), { status: res.status });
  return data;
}

function toast(msg, ok = true) {
  const t = $('#toast');
  t.textContent = msg; t.className = ok ? 'show ok' : 'show err';
  clearTimeout(toast.t); toast.t = setTimeout(() => { t.className = ''; }, 3500);
}

const fmt = (d) => (d ? new Date(d).toLocaleString('es-PE', { timeZone: 'America/Lima', dateStyle: 'short', timeStyle: 'medium' }) : '—');

function table(el, headers, rows) {
  el.replaceChildren();
  const thead = el.createTHead().insertRow();
  headers.forEach((h) => { const th = document.createElement('th'); th.textContent = h; thead.appendChild(th); });
  const tb = el.createTBody();
  if (!rows.length) { const c = tb.insertRow().insertCell(); c.colSpan = headers.length; c.textContent = 'Sin registros'; c.className = 'empty'; }
  rows.forEach((r) => { const tr = tb.insertRow(); r.forEach((v) => { const td = tr.insertCell(); if (v instanceof Node) td.appendChild(v); else td.textContent = v ?? '—'; }); });
}

const badge = (txt) => { const s = document.createElement('span'); s.className = `badge b-${txt}`; s.textContent = txt; return s; };

function formData(form) { return Object.fromEntries(new FormData(form).entries()); }

async function loadMerchants() {
  const ms = await api('/api/merchants');
  table($('#merchants-table'), ['#', 'Comerciante', 'Documento', 'Rubro', 'Puestos'],
    ms.map((m) => [m.id, m.full_name, m.document, m.category, m.stalls.map((s) => `${s.code} (${s.pavilion})`).join(', ') || '—']));
  const sel = $('#stall-merchant'); sel.replaceChildren();
  ms.forEach((m) => sel.add(new Option(`${m.full_name} — ${m.document}`, m.id)));
}

async function loadStalls() {
  const ss = await api('/api/stalls');
  $$('.stall-select').forEach((sel) => {
    const prev = sel.value; sel.replaceChildren();
    ss.forEach((s) => sel.add(new Option(`${s.code} · ${s.merchant}`, s.id)));
    if (prev) sel.value = prev;
  });
}

async function loadLots() {
  const st = $('#lot-filter').value;
  const ls = await api('/api/lots' + (st ? `?status=${encodeURIComponent(st)}` : ''));
  table($('#lots-table'), ['#', 'Producto', 'Cantidad', 'Ingreso', 'Puesto', 'Comerciante', 'Revisión sanitaria', 'Cambiar'],
    ls.map((l) => {
      const sel = document.createElement('select');
      ['PENDIENTE', 'APROBADO', 'OBSERVADO', 'RECHAZADO'].forEach((o) => sel.add(new Option(o, o, false, o === l.sanitary_status)));
      sel.addEventListener('change', async () => {
        try { await api(`/api/lots/${l.id}/review`, { method: 'POST', body: { sanitary_status: sel.value } }); toast(`Lote #${l.id}: ${sel.value}`); loadLots(); } catch (e) { toast(e.message, false); }
      });
      return [l.id, l.product, `${Number(l.quantity)} ${l.unit}`, l.received_on, l.stall, l.merchant, badge(l.sanitary_status), sel];
    }));
}

async function loadRequests() {
  const [rs, ps] = await Promise.all([api('/api/requests'), api('/api/porters')]);
  table($('#requests-table'), ['#', 'Puesto', 'Descripción', 'Llegada', 'Estado', 'Estibador', 'Asignado por', 'Hora asignación'],
    rs.map((r) => [r.id, r.stall, r.description, fmt(r.arrived_at), badge(r.status), r.porter, r.assigned_by, fmt(r.assigned_at)]));
  const box = $('#porters'); box.replaceChildren();
  ps.forEach((p) => { const d = document.createElement('div'); d.textContent = `${p.badge} · ${p.full_name} — último turno: ${fmt(p.last_assigned_at)}`; box.appendChild(d); });
}

async function loadHistory() {
  const hs = await api('/api/history');
  table($('#history-table'), ['Solicitud', 'Puesto', 'Descripción', 'Recibió el turno (estibador)', 'Asignado por (operador)', 'Llegada', 'Hora de asignación'],
    hs.map((h) => [`#${h.request_id}`, h.stall, h.description, `${h.porter} (${h.badge})`, h.assigned_by, fmt(h.arrived_at), fmt(h.assigned_at)]));
}

const loaders = { comerciantes: loadMerchants, lotes: () => Promise.all([loadStalls(), loadLots()]), estibaje: () => Promise.all([loadStalls(), loadRequests()]), historial: loadHistory };

function showTab(name) {
  $$('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  $$('.tab').forEach((t) => { t.hidden = t.id !== `tab-${name}`; });
  location.hash = name;
  loaders[name]().catch(handleErr);
}

function handleErr(e) { if (e.status === 401) return showLogin(); toast(e.message, false); }

function showLogin() { $('#login-view').hidden = false; $('#app-view').hidden = true; $('#who').hidden = true; }
function showApp(me) {
  $('#login-view').hidden = true; $('#app-view').hidden = false; $('#who').hidden = false;
  $('#who-name').textContent = `Operador: ${me.full_name}`;
  const tab = location.hash.slice(1);
  showTab(loaders[tab] ? tab : 'comerciantes');
}

function onSubmit(sel, fn) {
  $(sel).addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const btn = ev.target.querySelector('button[type=submit]'); btn.disabled = true;
    try { await fn(formData(ev.target), ev.target); } catch (e) { handleErr(e); } finally { btn.disabled = false; }
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  $$('.tabs button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
  $('input[name=received_on]').value = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Lima' });

  onSubmit('#login-form', async (d) => { const me = await api('/api/login', { method: 'POST', body: d }); toast(`Bienvenido, ${me.full_name}`); showApp(me); });
  onSubmit('#merchant-form', async (d, f) => { const m = await api('/api/merchants', { method: 'POST', body: d }); toast(`Comerciante #${m.id} registrado`); f.reset(); loadMerchants(); });
  onSubmit('#stall-form', async (d, f) => { const s = await api('/api/stalls', { method: 'POST', body: d }); toast(`Puesto ${s.code} registrado`); f.reset(); loadMerchants(); });
  onSubmit('#lot-form', async (d) => { const l = await api('/api/lots', { method: 'POST', body: d }); toast(`Lote #${l.id} registrado (${l.sanitary_status})`); loadLots(); });
  onSubmit('#request-form', async (d, f) => { const r = await api('/api/requests', { method: 'POST', body: d }); toast(`Solicitud #${r.id} en cola`); f.querySelector('[name=description]').value = ''; loadRequests(); });

  $('#assign-next').addEventListener('click', async (ev) => {
    ev.target.disabled = true;
    try { const a = await api('/api/requests/assign-next', { method: 'POST' }); toast(`Solicitud #${a.id} asignada a ${a.porter_name}`); loadRequests(); } catch (e) { handleErr(e); } finally { ev.target.disabled = false; }
  });
  $('#lot-filter').addEventListener('change', () => loadLots().catch(handleErr));
  $('#reload-history').addEventListener('click', () => loadHistory().catch(handleErr));
  $('#logout').addEventListener('click', async () => { await api('/api/logout', { method: 'POST' }); showLogin(); });

  try { showApp(await api('/api/me')); } catch { showLogin(); }
});
