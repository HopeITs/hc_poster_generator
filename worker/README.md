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
- `REELS_GEMINI_KEY` (optional) — a Gemini key from a separate Google project
  for the Reels Gen routes, so their free daily quota is not shared with the
  other tools; they use `GEMINI_API_KEY` until it is set

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
| POST | `/reels/music` | owner / comms |
| POST | `/reels/script` | `reels-gen` access |
| POST | `/reels/voice` | `reels-gen` access |
| POST | `/reels/moments` | `reels-gen` access |
| POST | `/reels/critique` | `reels-gen` access |

The Reels Gen routes log each call in `ai_usage` and cap it per user per 24 h.
`/reels/script` and `/reels/moments` use `GEMINI_API_KEY`; `/reels/music` and `/reels/voice` use
`ELEVENLABS_API_KEY`. `/reels/voice` reads with the Mazen Lawand voice: set
`ELEVENLABS_VOICE_ID` to pin it, otherwise it is looked up by name in the
account's voices, then in the shared library (and added to the account once,
which ElevenLabs requires before the API can use a library voice).
`/reels/moments` takes a long video's speech as Ogg Opus with the pause-bounded
segments the browser found, and works in two steps: Gemini transcribes each
segment from the audio (uploaded through the Files API and deleted right
after), then, from the text alone, picks the reel's goal from a fixed list and
the runs of segments that make whole thoughts in that goal's structure.
`/reels/critique` hears the cut reel's sound like a viewer who knows nothing
about the video (it is told only where each moment starts), says what it
understood, scores it and lists the problems by moment; below 8/10 the editor
revises the runs from the transcript with that critique in hand.

Photo endpoints take the email from the session, never from the request body,
so a user cannot modify anyone else's photo. Deletion is a `POST` because
`cors()` only advertises `GET, POST, OPTIONS`.
