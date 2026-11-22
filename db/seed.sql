-- Datos de demostración 100 % ficticios (LPG-18). Idempotente.
-- El hash scrypt corresponde a la contraseña del operador demo; la contraseña en
-- claro NO está en el repositorio (se entrega por separado en el informe).
INSERT INTO operators (username, full_name, password_hash) VALUES
  ('operador.demo', 'Operador Demo (ficticio)', 'scrypt$16384$688957ac91c00540ffc8ac634b688c0f$7fb27d997fa2ff71ffdf63d390f5ea55c97168e57fe69612df689860cf28a620b60370b096e24f0d7c45914cd436c514e4c3c7c8a0eb1bed9b580e1987240d87')
ON CONFLICT (username) DO NOTHING;

INSERT INTO merchants (full_name, document, category, created_by) VALUES
  ('Rosa Quispe Mamani (ficticia)',   '10000000001', 'Tubérculos', 1),
  ('Juan Huamán Ccori (ficticio)',     '10000000002', 'Frutas',     1),
  ('Comercial Andina SAC (ficticia)', '20000000003', 'Verduras',   1)
ON CONFLICT (document) DO NOTHING;

INSERT INTO stalls (code, pavilion, merchant_id, created_by)
SELECT v.code, v.pavilion, m.id, 1
FROM (VALUES ('A-001','Pabellón A','10000000001'),
             ('B-014','Pabellón B','10000000002'),
             ('C-022','Pabellón C','20000000003')) AS v(code, pavilion, doc)
JOIN merchants m ON m.document = v.doc
ON CONFLICT (code) DO NOTHING;

INSERT INTO lots (stall_id, product, quantity, unit, received_on, sanitary_status, created_by)
SELECT s.id, v.product, v.qty, v.unit, CURRENT_DATE, v.st, 1
FROM (VALUES ('A-001','Papa amarilla',  40, 'saco','APROBADO'),
             ('B-014','Mandarina',     120, 'jaba','PENDIENTE'),
             ('C-022','Cebolla roja',  1.5, 't',   'OBSERVADO')) AS v(code, product, qty, unit, st)
JOIN stalls s ON s.code = v.code
WHERE NOT EXISTS (SELECT 1 FROM lots);

INSERT INTO porters (full_name, badge) VALUES
  ('Pedro Estibador Uno (ficticio)', 'EST-01'),
  ('Luis Estibador Dos (ficticio)',  'EST-02'),
  ('Ana Estibadora Tres (ficticia)', 'EST-03')
ON CONFLICT (badge) DO NOTHING;
