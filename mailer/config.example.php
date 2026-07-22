<?php
/**
 * Copy to config.php on the server and fill in. config.php is gitignored --
 * the secret must never be committed.
 *
 * Generate the secret with:  openssl rand -hex 32
 * Set the identical value on the Worker with:  wrangler secret put MAIL_SECRET
 */
return [
    'secret'     => 'PUT-THE-SHARED-SECRET-HERE',
    'from_email' => 'no-reply@hcsyria.org',   // must be a real mailbox on this server
    'from_name'  => 'Hope Center',
];
