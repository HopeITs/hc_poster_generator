# post-gen

Single-page poster/story generator (`index.html`) with a Cloudflare Worker auth API (`auth_worker.js`).

## Stack

- Vanilla HTML/CSS/JS frontend
- Cloudflare Worker + D1 (auth, users, email notify)
- Resend (transactional email)
- html2canvas 1.4.1 (CDN, pinned with SRI)

## Setup

### 1. D1 database

Apply the schema:

```bash
wrangler d1 execute post-gen-db --file=schema.sql
```

### 2. Auth worker secrets

| Secret | Purpose |
|--------|---------|
| `SETUP_SECRET` | One-time owner setup (`POST /setup-owner`) |
| `RESEND_API_KEY` | Email notifications on export |
| `ALLOWED_ORIGINS` | **Required in production.** Comma-separated frontend origins, e.g. `https://rit.rar.gitlab.io,http://localhost:5500` |

Bind D1 as `DB` in the Worker settings.

### 3. Deploy auth worker

Deploy `auth_worker.js` to Cloudflare Workers. Update the `WORKER` URL at the top of the Auth block in `index.html` if your worker URL differs.

### 4. Host the frontend

Serve `index.html` from an origin listed in `ALLOWED_ORIGINS`. Sessions use HttpOnly cookies (`credentials: include`); the app must be served over HTTPS in production.

### 5. Create the first owner

```bash
curl -X POST https://YOUR-AUTH-WORKER/setup-owner \
  -H "Content-Type: application/json" \
  -d '{"secret":"YOUR_SETUP_SECRET","email":"owner@example.com","password":"your-secure-password"}'
```

Passwords require at least 8 characters.

## Usage

Open the hosted `index.html`, log in, fill in course details, export PNGs. On download, a copy is emailed to Owner/Comms users (rate-limited).

Optional: configure the AI style-transform Worker URL in the UI settings panel.

## Security notes

- Login rate limiting and notify rate limiting require `schema.sql` tables.
- Notify attachments are capped (count and total size); filenames are sanitized server-side.
- Project JSON files with unsafe image payloads are rejected on load.

## Tests

No automated tests. After changes, smoke-test manually: login/logout, user CRUD (admin), export + email notify, load/save project JSON.

## Dependencies

```bash
npm install   # optional; documents html2canvas 1.4.1 for audit
npm audit
```

The frontend loads html2canvas from cdnjs with Subresource Integrity.
