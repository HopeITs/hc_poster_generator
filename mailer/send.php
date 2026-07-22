<?php
/**
 * HTTP -> mail relay for the studyzone-auth Worker.
 *
 * Cloudflare Workers cannot speak SMTP, so /notify POSTs here instead and this
 * hands the message to the local MTA with mail(). Running on the same host as
 * mail.hcsyria.org means no SMTP credentials, no auth round-trip, and the
 * server's own DKIM signing applies.
 *
 * Deploy outside the document root if the panel allows it; otherwise keep the
 * filename unguessable. The shared secret is the only gate.
 */

header('Content-Type: application/json; charset=utf-8');

$CONFIG = require __DIR__ . '/config.php';

function fail($msg, $code) {
    http_response_code($code);
    echo json_encode(['error' => $msg], JSON_UNESCAPED_UNICODE);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') fail('method not allowed', 405);

// hash_equals: constant-time, so the secret cannot be guessed byte by byte
$given = $_SERVER['HTTP_X_AUTH'] ?? '';
if (!is_string($given) || !hash_equals($CONFIG['secret'], $given)) fail('unauthorized', 401);

$raw = file_get_contents('php://input');
$in  = json_decode($raw, true);
if (!is_array($in)) fail('invalid json', 400);

$to          = $in['to'] ?? [];
$subject     = (string)($in['subject'] ?? '');
$html        = (string)($in['html'] ?? '');
$attachments = is_array($in['attachments'] ?? null) ? $in['attachments'] : [];

if (!is_array($to)) $to = [$to];
$to = array_values(array_filter(array_map(function ($a) {
    return filter_var(trim((string)$a), FILTER_VALIDATE_EMAIL);
}, $to)));
if (!$to) fail('no valid recipients', 400);
if ($subject === '') fail('missing subject', 400);

// Any CR/LF reaching a header lets the caller inject arbitrary headers
$strip   = function ($s) { return str_replace(["\r", "\n"], ' ', $s); };
$subject = $strip($subject);

$boundary = 'b' . bin2hex(random_bytes(16));
$headers  = [
    'From: ' . $strip($CONFIG['from_name']) . ' <' . $CONFIG['from_email'] . '>',
    'Reply-To: ' . $CONFIG['from_email'],
    'MIME-Version: 1.0',
    'Content-Type: multipart/mixed; boundary="' . $boundary . '"',
];

$body  = "--$boundary\r\n";
$body .= "Content-Type: text/html; charset=UTF-8\r\n";
$body .= "Content-Transfer-Encoding: base64\r\n\r\n";
$body .= chunk_split(base64_encode($html)) . "\r\n";

foreach ($attachments as $a) {
    $name = basename($strip((string)($a['filename'] ?? 'file')));
    $data = (string)($a['content'] ?? '');           // already base64 from the Worker
    if ($data === '' || !preg_match('#^[A-Za-z0-9+/\r\n]+={0,2}$#', $data)) continue;
    $body .= "--$boundary\r\n";
    $body .= "Content-Type: application/octet-stream; name=\"$name\"\r\n";
    $body .= "Content-Disposition: attachment; filename=\"$name\"\r\n";
    $body .= "Content-Transfer-Encoding: base64\r\n\r\n";
    $body .= chunk_split(preg_replace('/\s+/', '', $data)) . "\r\n";
}
$body .= "--$boundary--\r\n";

// RFC 2047 encoding so the Arabic subject survives
$encSubject = '=?UTF-8?B?' . base64_encode($subject) . '?=';

$ok = mail(implode(', ', $to), $encSubject, $body, implode("\r\n", $headers), '-f' . $CONFIG['from_email']);

if (!$ok) fail('mail() failed — check the server mail log', 502);
echo json_encode(['ok' => true, 'recipients' => count($to)], JSON_UNESCAPED_UNICODE);
