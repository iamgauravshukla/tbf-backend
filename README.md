# The Better Face — API

A Node.js (Express) backend for the site. Two jobs:

1. **Lead capture** — receives the consultation form, stores each enquiry, sends the visitor to `/thank-you/`.
2. **Team dashboard API** — a gated login and authenticated endpoints to track, filter, look up and update leads (the CRM behind `/admin/`).

No database to run: leads live in a JSON file. The store is isolated in one
module, so wiring in **Railway Postgres** later means reimplementing that module —
the routes never change (see *Moving to Postgres* below).

---

## Run it

```bash
cd server
cp .env.example .env      # then edit — set ADMIN_EMAIL, ADMIN_PASSWORD, JWT_SECRET
npm install
npm run dev               # http://localhost:4000  (auto-restarts on change)
# or: npm start           # production
```

Node 18+ (uses built-in `fetch` and `node --watch`).

---

## Endpoints

### Public

| Method | Path          | Notes |
| ------ | ------------- | ----- |
| `POST` | `/api/leads`  | The consultation form target (url-encoded or JSON). |
| `GET`  | `/api/health` | Liveness check. |

`POST /api/leads` reads exactly what the form sends — `name`, `email`, `phone`,
`treatment`, `message`, `consent`, `source`, `_next`, `_gotcha` — honeypots bots,
validates, stores with `status: "new"`, optionally forwards to `WEBHOOK_URL`,
mirrors the lead to the external CRM intake (`CRM_FORWARD_URL`), and
`303`-redirects a form post to `_next` (validated to your own domain).

Both forwards are fire-and-forget with an 8s timeout — the lead is saved before
either runs, so a downstream outage never loses an enquiry. The CRM receives its
own shape: `{ fullname, email, phone, treatment, message }`, with `type` and
`center` on the query string.

### Dashboard (auth)

| Method  | Path                             | Notes |
| ------- | -------------------------------- | ----- |
| `POST`  | `/api/auth/login`                | `{ email, password }` → `{ token, user }`. |
| `GET`   | `/api/auth/me`                   | Current user. |
| `POST`  | `/api/auth/password`             | Change own password (`currentPassword`, `newPassword`). |
| `GET`   | `/api/admin/stats`               | Totals, today, week, unassigned, counts by status — scoped to the viewer. |
| `GET`   | `/api/admin/agents`              | Team directory for owner/assignee dropdowns. |
| `GET`   | `/api/admin/leads`               | Filter/search/paginate — see below. |
| `GET`   | `/api/admin/leads/:id`           | One lead. |
| `PATCH` | `/api/admin/leads/:id`           | Update `status`, `assignedTo`, `notes`, `appointmentAt`. |
| `GET`   | `/api/admin/leads/:id/activity`  | The lead's timeline (newest first). |
| `POST`  | `/api/admin/leads/:id/activity`  | Log a `note` / `call` / `message`. |
| `GET`   | `/api/users`                     | List team (admin/manager). |
| `POST`  | `/api/users`                     | Create a member (admin/manager; managers → agents only). |
| `PATCH` | `/api/users/:id`                 | Change name/role/active/password. |
| `GET`   | `/api/tasks`                     | Follow-ups (`scope=mine`\|`overdue`\|`all`, `done`, `leadId`). |
| `POST`  | `/api/tasks`                     | Create a task. |
| `PATCH` | `/api/tasks/:id`                 | Update / complete. |
| `DELETE`| `/api/tasks/:id`                 | Remove. |

Every `/api/admin`, `/api/users` and `/api/tasks` route needs `Authorization: Bearer <token>`.

**Roles:** `admin` (everything, incl. team + all leads), `manager` (all leads, assign,
manage agents), `agent` (own + unassigned leads, own tasks). Agents only see their own
and unassigned leads; managers/admins see all. The env `ADMIN_EMAIL`/`ADMIN_PASSWORD`
seed the first admin account on first run — after that the stored password is the source
of truth.

**List query params:** `status`, `q` (searches name/email/phone/treatment/message/notes/source),
`from`, `to` (YYYY-MM-DD, inclusive), `treatment`, `source`, `assignedTo` (a user id,
`mine`, or `none`), `limit`, `offset`.

**Statuses:** `new`, `contacted`, `booked`, `completed`, `cancelled`, `lost`.

Quick check:

```bash
# create a lead
curl -s -X POST localhost:4000/api/leads -d "name=Jane" -d "phone=09171234567" \
  -d "treatment=HIFU" -d "consent=on" -d "source=curl"

# log in, then list
TOKEN=$(curl -s -X POST localhost:4000/api/auth/login -H 'content-type: application/json' \
  -d '{"email":"admin@thebetterface.com","password":"YOUR_PASSWORD"}' | jq -r .token)
curl -s -H "authorization: Bearer $TOKEN" "localhost:4000/api/admin/leads?status=new"
```

---

## The dashboard front end

Lives in the Astro site, not here:

- `client/src/pages/admin/login.astro` — the gated login.
- `client/src/pages/admin/index.astro` — the leads dashboard.

Both read `apiBase` from `client/src/site.config.ts`. Set it (and `formEndpoint`)
to this server's URL — `http://localhost:4000` in dev, your API host in production.
`ALLOWED_ORIGINS` here must include the site's origin so the dashboard can call the API.

---

## Wire the site to it

In `client/src/site.config.ts`:

```
formEndpoint: "http://localhost:4000/api/leads",   // your API host in production
apiBase:      "http://localhost:4000",             // your API host in production
```

Set `ALLOWED_ORIGINS` and `SITE_URL` in `.env` to your real domain before launch.

---

## Configuration (`.env`)

`PORT`, `ALLOWED_ORIGINS`, `SITE_URL`, `THANK_YOU_PATH`, `DATA_DIR`, `WEBHOOK_URL`,
`CRM_FORWARD_URL` / `CRM_FORWARD_TYPE` / `CRM_FORWARD_CENTER` (external CRM mirror —
set `CRM_FORWARD_URL=` empty to disable, e.g. in local dev), `API_KEY`, and for the
dashboard: `JWT_SECRET`, `TOKEN_TTL`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`. See
`.env.example`. Generate a secret with `openssl rand -hex 32`.

---

## Deploy to Railway

This is a **monorepo** (`client/` + `server/`). The API is only the `server/`
folder, so the Railway service must build from there — otherwise Railway runs the
root `package.json`, whose `build` compiles the *frontend* and fails.

1. **Service → Settings → Root Directory = `server`.** Railway then reads
   `server/railway.json` (start `npm start`, healthcheck `/api/health`).
2. **Variables** — set at minimum:
   - `JWT_SECRET` — a fixed value (`openssl rand -hex 32`). Without it, every
     restart logs everyone out.
   - `ADMIN_EMAIL`, `ADMIN_PASSWORD` — seed the first admin (login is disabled
     until these are set).
   - `ALLOWED_ORIGINS` — your deployed site origin(s), comma-separated (e.g.
     `https://thebetterface.com`). The dashboard is a different origin, so the API
     rejects it without this.
   - `SITE_URL` — your site URL (validates the form redirect, thank-you fallback).
   - Optional: `CRM_FORWARD_URL=` (empty) on a staging deploy so test leads don't
     reach the live CRM.
   - **Do not set `PORT`** — Railway injects it and the server reads it.
3. **Persist the data.** The container filesystem is **ephemeral** — `data/*.json`
   (leads, users, activity, tasks) is wiped on every deploy. Attach a **Volume**
   (mount e.g. `/data`) and set `DATA_DIR=/data`, or move to Postgres (below).
   Until one of those, treat the deploy as non-durable.
4. The **frontend** deploys separately (static Astro). Point its
   `apiBase`/`formEndpoint` (`client/src/site.config.ts`) at this service's public
   URL, and add that URL's origin to `ALLOWED_ORIGINS` here.

---

## Postgres

Storage runs on **Postgres when `DATABASE_URL` is set**, and on the JSON files
otherwise — the routes never change. Each domain module (`store.js` leads,
`users.js`, `activity.js`, `tasks.js`) has both paths; `db.js` is the JSON engine,
`pg.js` is the connection pool + schema.

**Enable it:**
- Locally: `DATABASE_URL=postgres://user:pass@host:5432/db` in `.env`.
- Railway: add a Postgres service, then a variable
  `DATABASE_URL=${{Postgres.DATABASE_URL}}` on the API service.

On boot, `pg.js` **creates the tables and indexes if they don't exist** (idempotent)
and the env admin is seeded once. Tables: `users`, `leads`, `activity`, `tasks`
(schema in `src/lib/pg.js`). Ids are UUIDs generated by the app. Notes:
- An **unresolved template** (`${{Postgres.DATABASE_URL}}` seen literally, e.g. in a
  local `.env`) or any non-`postgres://` value is ignored — the app falls back to
  the JSON store instead of crashing.
- TLS is inferred from the host (Railway's private `.railway.internal` = none, public
  proxies = on). Override with `PGSSL=true|false`.
- `password_hash` is scrypt (Node built-in). `activity.meta` is `JSONB`.

---

## Structure

```
server/
  src/
    index.js          bootstrap + graceful shutdown
    app.js            express app, middleware, route mounting
    config.js         env config (incl. auth + CRM forward)
    routes/
      leads.js        POST /api/leads (public)
      auth.js         login, me, change password
      admin.js        leads, stats, agents, activity (Bearer auth)
      users.js        team management (admin/manager)
      tasks.js        follow-up tasks
    lib/
      validate.js     lead validation
      db.js           JSON-collection engine  ← swap for Postgres
      store.js        leads: create/get/update/list/stats
      users.js        accounts, roles, scrypt password hashing
      activity.js     per-lead timeline
      tasks.js        follow-up tasks
      auth.js         authenticate, JWT sign/verify, requireAuth, requireRole
      notify.js       webhook + external CRM forward
  data/               leads.json, users.json, activity.json, tasks.json (git-ignored)
  .env.example
```

## Notes for production

- Behind HTTPS + a reverse proxy; `trust proxy` is on for correct client IPs.
- Set a strong `ADMIN_PASSWORD` and a fixed `JWT_SECRET` (logins drop on restart otherwise).
- Rate limiting (incl. a tighter login limiter) and Helmet headers are on by default.
- Back up `data/leads.json`, or move to Postgres.
