# studyzone-auth — Worker

Backend for [`index.html`](../index.html): login, sessions, roles, projects,
and profile photos. Runs on Cloudflare Workers against the `studyzone-db` D1
database (bound as `DB`).

The frontend points at it via `var WORKER` in `index.html`.

## Why this directory exists

This source was recovered from the deployed Worker with
`wrangler init --from-dash studyzone-auth`. The only earlier copy in git
(`auth_worker.js`, deleted in `d4aafec`) was stale — it predates `/projects`,
`/projects/add`, `/projects/update` and `/users/set-projects`, so deploying it
would break the project picker. Treat this directory as the source of truth and
keep it in step with what is deployed.

## Secrets

Not in this repo and not in `wrangler.jsonc` — they live in Cloudflare's secret
store and survive deploys:

- `RESEND_API_KEY` — email sending for `/notify`
- `SETUP_SECRET` — guards `/setup-owner` and `/change-owner-email`

## Deploying

```bash
cd worker
wrangler deploy
```

`wrangler rollback --name studyzone-auth` reverts to the previous version.

Back the database up before any schema change:

```bash
wrangler d1 export studyzone-db --remote --output backup.sql
```

## Endpoints

| Method | Path | Auth |
|---|---|---|
| GET | `/health` | — |
| POST | `/setup-owner` | `SETUP_SECRET` |
| POST | `/change-owner-email` | `SETUP_SECRET` |
| POST | `/login` | — |
| GET | `/me` | session |
| POST | `/logout` | session |
| POST | `/me/photo` | session |
| POST | `/me/photo/delete` | session |
| GET | `/users` | manage_users |
| POST | `/users/add` | manage_users |
| POST | `/users/delete` | manage_users |
| POST | `/users/set-projects` | manage_users |
| POST | `/users/set-password` | manage_users |
| GET | `/projects` | session |
| POST | `/projects/add` | owner |
| POST | `/projects/update` | owner |
| POST | `/notify` | session |

Photo endpoints take the email from the session, never from the request body,
so a user cannot modify anyone else's photo. Deletion is a `POST` because
`cors()` only advertises `GET, POST, OPTIONS`.
