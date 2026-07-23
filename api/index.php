<?php
/**
 * موجّه الـAPI — بديل Cloudflare Worker.
 *
 * كل الطلبات تصل هنا عبر api/.htaccess. المسار يُقرأ من PATH_INFO أو من
 * REQUEST_URI بعد /api، ليعمل سواء كان الـAPI في جذر النطاق أو في مجلد.
 *
 * لا رؤوس CORS: الواجهة والـAPI على الأصل نفسه، وهذا بالضبط ما يسمح
 * باستعمال كوكي HttpOnly بدل توكن في localStorage.
 */

declare(strict_types=1);

require __DIR__ . '/lib/http.php';
require __DIR__ . '/lib/db.php';
require __DIR__ . '/lib/perms.php';
require __DIR__ . '/lib/auth.php';
require __DIR__ . '/lib/projects.php';
require __DIR__ . '/lib/mail.php';
require __DIR__ . '/routes/auth.php';
require __DIR__ . '/routes/users.php';
require __DIR__ . '/routes/projects.php';
require __DIR__ . '/routes/photo.php';
require __DIR__ . '/routes/notify.php';

/** المسار المطلوب، بلا الشرطة الأخيرة. مثال: /login */
function route_path(): string
{
    $p = $_SERVER['PATH_INFO'] ?? '';
    if ($p === '') {
        $uri = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
        // احذف كل ما يسبق /api ويشمله
        $pos = strpos($uri, '/api');
        $p = $pos === false ? $uri : substr($uri, $pos + 4);
    }
    $p = rtrim($p, '/');
    return $p === '' ? '/' : $p;
}

$path   = route_path();
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

try {
    // ---- فحص الصحة ----
    if ($method === 'GET' && ($path === '/' || $path === '/health')) {
        json_out([
            'ok'      => true,
            'service' => 'postgen-api',
            'version' => 1,
            // إثبات أن الاتصال بقاعدة البيانات يعمل، لا مجرد أن PHP يستجيب
            'db'      => db_one('SELECT 1 AS ok') ? 'up' : 'down',
        ]);
    }

    // كل دالة route_* ترد وتنهي الطلب إن طابق المسار، وإلا عادت هنا
    route_auth($method, $path);
    route_users($method, $path);
    route_projects($method, $path);
    route_photo($method, $path);
    route_notify($method, $path);

    fail('Not found', 404);

} catch (Throwable $e) {
    // التفاصيل إلى سجل الخادم فقط — الرسالة قد تحوي استعلامات أو مسارات
    error_log('API error: ' . $e->getMessage());
    fail('خطأ داخلي', 500);
}
