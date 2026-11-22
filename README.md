# La Parada | Gestión Mayorista

Aplicación web académica (PC2 · Proyecto Final de Carrera III · USIL 2026-2) que responde a tres problemas del caso
*La Parada*: **comercio sin registro**, **falta de trazabilidad sanitaria** y **asignación informal del estibaje**.
Todos los datos son **ficticios**.

- Producción: https://la-parada-gestion-pc2.vercel.app (Vercel, rama `main`)
- Backlog Scrum: proyecto Jira `LPG` (https://matiosystem.atlassian.net/jira/software/projects/LPG/boards/3)

## Recorrido de demostración

1. El operador inicia sesión (cookie de sesión firmada, HttpOnly, SameSite=Strict).
2. Registra un comerciante y su puesto (pestaña 1).
3. Registra un lote con producto, cantidad, unidad, fecha y estado de revisión sanitaria (pestaña 2).
4. Crea dos solicitudes de estibaje y pulsa **Asignar siguiente turno**: se asigna la más antigua (FIFO) al estibador que lleva más tiempo sin turno (pestaña 3).
5. Consulta el **Historial** (pestaña 4): quién recibió el turno, quién lo asignó y a qué hora. Al recargar, persiste.

Las credenciales del operador demo **no están en el repositorio**: se entregan en el informe. En la base solo existe su hash scrypt.

## Arquitectura

| Capa | Tecnología | Archivo |
|---|---|---|
| Frontend | HTML + CSS + JavaScript sin framework (servido estático por Vercel CDN) | `public/` |
| Backend/API | Función serverless Node.js en Vercel, router único | `api/index.js`, `lib/app.js` |
| Reglas de negocio | Validación, FIFO, bloqueo de filas | `lib/service.js` |
| Autenticación | scrypt + token HMAC-SHA256 en cookie HttpOnly; autorización en servidor | `lib/auth.js` |
| Base de datos | PostgreSQL serverless (Neon, integración de Vercel) | `db/schema.sql`, `db/seed.sql`, `lib/db.js` |
| CI/CD | GitHub Actions: build, pruebas, npm audit, Gitleaks, Semgrep | `.github/workflows/ci.yml` |

### «Asignar siguiente turno» sin duplicados (`lib/service.js` → `assign`)

En una transacción: `SELECT … WHERE status='EN_COLA' ORDER BY arrived_at, id LIMIT 1 FOR UPDATE SKIP LOCKED`
(toma la más antigua y la bloquea), elige estibador por rotación, `UPDATE … WHERE id=$1 AND status='EN_COLA'`
(si no actualiza exactamente 1 fila → 409) e inserta en `assignments`, cuya restricción `UNIQUE(request_id)` es la última barrera.

## Ejecutar en local

```bash
cp .env.example .env            # ajuste DATABASE_URL
docker run -d --name lpg-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=laparada_test -p 55432:5432 postgres:16-alpine
npm ci
npm run db:migrate              # esquema + datos demo
npm start                       # http://localhost:3000
npm test                        # 13 pruebas (usa TEST_DATABASE_URL o postgres://postgres:postgres@localhost:55432/laparada_test)
```

## Ramas y despliegue

- `test`: integración. Cada push ejecuta el pipeline y Vercel genera un despliegue *preview*.
- `main`: producción. Solo recibe cambios por Pull Request desde `test`; el despliegue de producción depende de que pasen
  **Build y pruebas** y **Seguridad**.

## Variables de entorno

| Variable | Uso |
|---|---|
| `DATABASE_URL` | Conexión PostgreSQL. En Vercel la inyecta la integración Neon. Nunca se versiona. |
| `SESSION_SECRET` | Opcional. Si falta, la API genera una clave aleatoria y la guarda en la tabla `app_config`. |
