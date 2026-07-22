# mailer — HTTP → mail relay

Replaces Resend for the Worker's `/notify` endpoint.

## Why a relay exists

Cloudflare Workers cannot open SMTP connections, so `/notify` cannot talk to a
mail server directly. It POSTs JSON here instead, and this script hands the
message to the local MTA.

## Why this host

`mail.hcsyria.org` and `s1893.sureserver.com` both resolve to `195.42.143.64` —
the hosting account *is* the mail server, and the domain's MX already points at
it. So there is nothing to install: no Postfix, no DKIM keygen, no PTR request,
no IP warm-up. `mail()` hands straight to the local MTA and inherits whatever
DKIM signing the panel has configured.

The server is a VPS under our control, so Node and systemd are available too.
PHP is still the right choice here: the script runs on the same host as the
MTA, so `mail()` needs no SMTP credentials, no listening service and no
supervision — there is nothing to keep running.

## Install

1. Create the mailbox `no-reply@hcsyria.org` in the hosting panel.
2. Upload `send.php` — outside the document root if the panel allows, otherwise
   under an unguessable path. The shared secret is the only thing gating it.
3. Copy `config.example.php` to `config.php` beside it and fill in:

   ```bash
   openssl rand -hex 32        # the value for 'secret'
   ```

4. Give the Worker the same values:

   ```bash
   cd worker
   wrangler secret put MAIL_SECRET      # paste the same secret
   wrangler secret put MAIL_ENDPOINT    # https://hcsyria.org/<path>/send.php
   wrangler deploy
   ```

5. Delete the now-unused Resend key:

   ```bash
   wrangler secret delete RESEND_API_KEY --name studyzone-auth
   ```

Posters are large. If sends fail on size, raise `post_max_size` and
`memory_limit` (30M is enough) in the panel's PHP settings.

## DNS — do this, it is not optional

The domain currently publishes **no TXT records at all**, so there is no SPF.
One of the two recipients is on Gmail, which treats unauthenticated mail
harshly. Add at minimum:

| Type | Host | Value |
|---|---|---|
| TXT | `@` | `v=spf1 a mx ip4:195.42.143.64 ~all` |
| TXT | `_dmarc` | `v=DMARC1; p=none; rua=mailto:postmaster@hcsyria.org` |

Enable DKIM — from the panel's email-deliverability page if one is installed,
otherwise with `opendkim` directly on the VPS (see MIGRATION.ar.md). Publish
the record it generates.

Note the domain also lists `mail.google.com` as a secondary MX. If mail for the
domain is meant to be delivered to Google rather than this server, that needs
sorting out separately — it does not affect sending, but it does affect where
replies land.

## Testing

```bash
curl -sS -X POST "https://hcsyria.org/<path>/send.php" \
  -H "Content-Type: application/json" -H "X-Auth: <secret>" \
  -d '{"to":["you@example.com"],"subject":"اختبار","html":"<b>مرحبا</b>"}'
```

Expect `{"ok":true,"recipients":1}`. Watch the Worker end with:

```bash
wrangler tail --name studyzone-auth --format pretty
```

## Security

- `hash_equals` for the secret, so it cannot be probed byte by byte.
- CR/LF stripped from anything reaching a header — otherwise a caller could
  inject headers and use this as an open relay.
- Recipients validated with `FILTER_VALIDATE_EMAIL`; attachment names passed
  through `basename()`; attachment payloads must be base64.
- The endpoint never takes `from` from the request — it comes from `config.php`.
