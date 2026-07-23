<?php
/**
 * كلمات السر والجلسات والحظر.
 *
 * الفارق الجوهري عن الـWorker: الجلسة تُحمل في كوكي HttpOnly لا في توكن
 * يعيده الرد ليُخزَّن في localStorage. JavaScript لا يستطيع قراءة الكوكي،
 * فسرقة الجلسة عبر XSS لم تعد ممكنة.
 */

declare(strict_types=1);

const COOKIE_NAME       = 'pg_session';
const PBKDF2_ITERATIONS = 100000;   // مطابق للـWorker — لا تغيّره أو تتعطّل كل كلمات السر
const PBKDF2_BYTES      = 32;

const LOGIN_WINDOW_MIN = 15;
const LOGIN_MAX_EMAIL  = 5;
const LOGIN_MAX_IP     = 20;

/* ---------- كلمات السر ---------- */

/**
 * تنسيق التخزين: saltHex(32) + ':' + hashHex(64)
 * نفس ناتج WebCrypto في الـWorker بالضبط — مُختبَر ومتطابق، فلا يحتاج
 * أي مستخدم إلى إعادة تعيين كلمته.
 */
function hash_password(string $password, ?string $saltHex = null): string
{
    $salt = $saltHex !== null ? hex2bin($saltHex) : random_bytes(16);
    $bits = hash_pbkdf2('sha256', $password, $salt, PBKDF2_ITERATIONS, PBKDF2_BYTES, true);
    return bin2hex($salt) . ':' . bin2hex($bits);
}

function verify_password(string $password, string $stored): bool
{
    $parts = explode(':', $stored, 2);
    if (count($parts) !== 2 || $parts[0] === '' || $parts[1] === '') return false;
    if (!ctype_xdigit($parts[0])) return false;
    // hash_equals: مقارنة ثابتة الزمن، فلا يُستدلّ على الهاش من زمن الرد
    return hash_equals($parts[1], explode(':', hash_password($password, $parts[0]), 2)[1]);
}

/* ---------- الجلسات ---------- */

function make_token(): string
{
    return bin2hex(random_bytes(32));
}

function session_cookie(string $token, int $expiresAt): void
{
    setcookie(COOKIE_NAME, $token, [
        'expires'  => $expiresAt,
        'path'     => '/',
        'secure'   => (bool)(config()['cookie_secure'] ?? true),
        'httponly' => true,        // ← الثغرة تُغلق هنا: JS لا يقرأه
        'samesite' => 'Strict',    // ← ولا يُرسَل في طلبات من مواقع أخرى (CSRF)
    ]);
}

function start_session(string $email, bool $remember): void
{
    // تنظيف انتهازي: الـWorker كان يحذف الجلسة المنتهية فقط عند استعمالها،
    // فتبقى الجلسات المهجورة إلى الأبد — 47 صفاً لثمانية مستخدمين في D1.
    db_run('DELETE FROM sessions WHERE expires_at < ?', [gmdate('Y-m-d H:i:s')]);

    $token = make_token();
    $exp   = time() + ($remember ? 30 : 1) * 86400;
    db_run(
        'INSERT INTO sessions (token, email, expires_at) VALUES (?, ?, ?)',
        [$token, $email, gmdate('Y-m-d H:i:s', $exp)]
    );
    session_cookie($token, $exp);
}

function end_session(): void
{
    $token = $_COOKIE[COOKIE_NAME] ?? '';
    if ($token !== '') db_run('DELETE FROM sessions WHERE token = ?', [$token]);
    session_cookie('', time() - 3600);
}

/** المستخدم الحالي من الكوكي، أو null. تحذف الجلسة إن انتهت صلاحيتها. */
function current_user(): ?array
{
    static $cached = false;
    if ($cached !== false) return $cached;

    $token = $_COOKIE[COOKIE_NAME] ?? '';
    if ($token === '' || !ctype_xdigit($token)) return $cached = null;

    $row = db_one(
        'SELECT s.token, s.expires_at, u.email, u.role, u.project_id, u.photo
           FROM sessions s JOIN users u ON u.email = s.email
          WHERE s.token = ?',
        [$token]
    );
    if (!$row) return $cached = null;

    if (strtotime((string)$row['expires_at'] . ' UTC') < time()) {
        db_run('DELETE FROM sessions WHERE token = ?', [$token]);
        return $cached = null;
    }

    return $cached = [
        'email'      => $row['email'],
        'role'       => $row['role'],
        'project_id' => $row['project_id'] === null ? null : (int)$row['project_id'],
        'photo'      => $row['photo'],
        'token'      => $row['token'],
    ];
}

/** يوقف الطلب بـ401 إن لم يكن هناك مستخدم. */
function require_user(): array
{
    $u = current_user();
    if (!$u) fail('غير مسجّل دخول', 401);
    return $u;
}

/* ---------- حظر محاولات الدخول ---------- */

/** يُفحص قبل التحقق من كلمة السر، فلا تُستهلك دورات PBKDF2 على محاولة محجوبة. */
function login_blocked(string $email, string $ip): bool
{
    $since = gmdate('Y-m-d H:i:s', time() - LOGIN_WINDOW_MIN * 60);
    $row = db_one(
        'SELECT
           (SELECT COUNT(*) FROM login_attempts WHERE email = ? AND at > ?) AS by_email,
           (SELECT COUNT(*) FROM login_attempts WHERE ip = ? AND ip <> \'\' AND at > ?) AS by_ip',
        [$email, $since, $ip, $since]
    );
    return $row && ((int)$row['by_email'] >= LOGIN_MAX_EMAIL || (int)$row['by_ip'] >= LOGIN_MAX_IP);
}

function record_login_failure(string $email, string $ip): void
{
    db_run('INSERT INTO login_attempts (email, ip, at) VALUES (?, ?, ?)',
        [$email, $ip, gmdate('Y-m-d H:i:s')]);
}

function clear_login_failures(string $email): void
{
    db_run('DELETE FROM login_attempts WHERE email = ?', [$email]);
    db_run('DELETE FROM login_attempts WHERE at < ?', [gmdate('Y-m-d H:i:s', time() - 86400)]);
}
