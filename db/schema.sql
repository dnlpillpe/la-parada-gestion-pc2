-- La Parada | Gestión Mayorista — esquema PostgreSQL (idempotente)
-- Se aplica con `npm run db:migrate` o automáticamente en el primer arranque de la API.

CREATE TABLE IF NOT EXISTS operators (
  id            SERIAL PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  full_name     TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Clave de firma de sesiones generada en el primer arranque (no vive en el repositorio).
CREATE TABLE IF NOT EXISTS app_config (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS merchants (
  id          SERIAL PRIMARY KEY,
  full_name   TEXT NOT NULL,
  document    TEXT NOT NULL UNIQUE,          -- DNI/RUC ficticio
  category    TEXT NOT NULL,                 -- rubro: frutas, verduras, tubérculos...
  created_by  INTEGER NOT NULL REFERENCES operators(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS stalls (
  id          SERIAL PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,          -- p. ej. "A-012"
  pavilion    TEXT NOT NULL,
  merchant_id INTEGER NOT NULL REFERENCES merchants(id),
  created_by  INTEGER NOT NULL REFERENCES operators(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lots (
  id                SERIAL PRIMARY KEY,
  stall_id          INTEGER NOT NULL REFERENCES stalls(id),
  product           TEXT NOT NULL,
  quantity          NUMERIC(12,2) NOT NULL CHECK (quantity > 0),
  unit              TEXT NOT NULL CHECK (unit IN ('kg','t','saco','caja','jaba')),
  received_on       DATE NOT NULL,
  sanitary_status   TEXT NOT NULL DEFAULT 'PENDIENTE'
                    CHECK (sanitary_status IN ('PENDIENTE','APROBADO','OBSERVADO','RECHAZADO')),
  reviewed_by       INTEGER REFERENCES operators(id),
  reviewed_at       TIMESTAMPTZ,
  created_by        INTEGER NOT NULL REFERENCES operators(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS porters (               -- estibadores
  id               SERIAL PRIMARY KEY,
  full_name        TEXT NOT NULL,
  badge            TEXT NOT NULL UNIQUE,
  active           BOOLEAN NOT NULL DEFAULT true,
  last_assigned_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS stowage_requests (      -- solicitudes de estibaje
  id          SERIAL PRIMARY KEY,
  stall_id    INTEGER NOT NULL REFERENCES stalls(id),
  description TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'EN_COLA' CHECK (status IN ('EN_COLA','ASIGNADA')),
  arrived_at  TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  created_by  INTEGER NOT NULL REFERENCES operators(id),
  porter_id   INTEGER REFERENCES porters(id),
  assigned_by INTEGER REFERENCES operators(id),
  assigned_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_requests_queue ON stowage_requests (status, arrived_at, id);

-- Historial inmutable de asignaciones. UNIQUE(request_id) es la última barrera
-- contra asignar dos veces la misma solicitud.
CREATE TABLE IF NOT EXISTS assignments (
  id          SERIAL PRIMARY KEY,
  request_id  INTEGER NOT NULL UNIQUE REFERENCES stowage_requests(id),
  porter_id   INTEGER NOT NULL REFERENCES porters(id),
  assigned_by INTEGER NOT NULL REFERENCES operators(id),
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
