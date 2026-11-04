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

/**
 * المستخدم الحالي، أو null. المصدر مفتاح API إن أُرسل، وإلا كوكي الجلسة.
 * تحذف الجلسة إن انتهت صلاحيتها.
 *
 * 'via' يقول من أين جاء: 'session' أو 'key'. مع المفتاح يأتي 'scope' أيضاً.
 */
function current_user(): ?array
{
    static $cached = false;
    if ($cached !== false) return $cached;

    $key = presented_api_key();
    if ($key !== null) return $cached = api_key_user($key);

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
        'via'        => 'session',
    ];
}

/**
 * يوقف الطلب بـ401 إن لم يكن هناك مستخدم.
 * مفتاح read يُرفض في أي طلب غير GET، فلا يغيّر شيئاً مهما كان دور صاحبه.
 */
function require_user(): array
{
    $u = current_user();
    if (!$u) fail('غير مسجّل دخول', 401);
    if ($u['via'] === 'key' && $u['scope'] !== 'write' && ($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') {
        fail('هذا المفتاح للقراءة فقط', 403);
    }
    return $u;
}

/**
 * مثل require_user لكن بجلسة متصفح حصراً. لإدارة المفاتيح نفسها:
 * مفتاح مسرَّب لا يستطيع أن يولّد مفاتيح أخرى تبقى بعد إلغائه.
 */
function require_session(): array
{
    $u = require_user();
    if ($u['via'] !== 'session') fail('هذه العملية تتطلب تسجيل الدخول من المتصفح', 403);
    return $u;
}

/* ---------- مفاتيح API ---------- */

const API_KEY_PREFIX = 'pgk_';

/** مفتاح جديد: البادئة + 40 محرف hex (160 بت). */
function make_api_key(): string
{
    return API_KEY_PREFIX . bin2hex(random_bytes(20));
}

function api_key_hash(string $key): string
{
    return hash('sha256', $key);
}

/**
 * المفتاح المُرسَل في الطلب، أو null إن لم يُرسَل.
 * يُقبل في Authorization: Bearer أو في X-API-Key.
 *
 * Apache مع FastCGI يحذف رأس Authorization ما لم يمرّره api/.htaccess،
 * فيصل أحياناً باسم REDIRECT_HTTP_AUTHORIZATION.
 */
function presented_api_key(): ?string
{
    $auth = (string)($_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '');
    if (preg_match('/^Bearer\s+(\S+)$/i', trim($auth), $m)) return $m[1];

    $x = trim((string)($_SERVER['HTTP_X_API_KEY'] ?? ''));
    return $x === '' ? null : $x;
}

/**
 * صاحب المفتاح بدوره الحالي، أو يوقف الطلب بـ401.
 * لا رجوع إلى الكوكي عند مفتاح خاطئ: من أرسل مفتاحاً يريد أن يُعرَف به.
 */
function api_key_user(string $key): array
{
    if (!str_starts_with($key, API_KEY_PREFIX)) fail('مفتاح API غير صالح', 401);

    $row = db_one(
        'SELECT k.id, k.scope, k.expires_at, k.last_used_at, u.email, u.role, u.project_id, u.photo
           FROM api_keys k JOIN users u ON u.email = k.email
          WHERE k.key_hash = ?',
        [api_key_hash($key)]
    );
    if (!$row) fail('مفتاح API غير صالح', 401);

    if ($row['expires_at'] !== null && strtotime((string)$row['expires_at'] . ' UTC') < time()) {
        fail('انتهت صلاحية مفتاح API', 401);
    }

    // مرة في الدقيقة على الأكثر، لا كتابة مع كل طلب
    $now = time();
    if ($row['last_used_at'] === null || strtotime((string)$row['last_used_at'] . ' UTC') < $now - 60) {
        db_run('UPDATE api_keys SET last_used_at = ? WHERE id = ?', [gmdate('Y-m-d H:i:s', $now), $row['id']]);
    }

    return [
        'email'      => $row['email'],
        'role'       => $row['role'],
        'project_id' => $row['project_id'] === null ? null : (int)$row['project_id'],
        'photo'      => $row['photo'],
        'via'        => 'key',
        'key_id'     => (int)$row['id'],
        'scope'      => $row['scope'],
    ];
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
