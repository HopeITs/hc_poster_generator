<?php
/**
 * /setup-owner · /change-owner-email
 *
 * نقطتا تهيئة واسترداد، محميّتان بسرّ من الإعدادات لا بجلسة — لأنهما
 * تُستعملان قبل وجود أي حساب، أو حين يتعذّر الدخول إلى حساب المالك.
 */

declare(strict_types=1);

/**
 * يتحقّق من سرّ الإعداد ويوقف الطلب عند الفشل.
 *
 * hash_equals: مقارنة ثابتة الزمن. الـWorker كان يقارن بـ!== مباشرة،
 * وهي مقارنة تتوقّف عند أول اختلاف فيتسرّب طول البادئة الصحيحة من زمن الرد.
 */
function require_setup_secret(): void
{
    $expected = (string)(config()['setup_secret'] ?? '');
    $given    = (string)(body()['secret'] ?? '');

    // سرّ فارغ في الإعدادات يعني أن النقطتين معطّلتان، لا أنهما مفتوحتان
    if ($expected === '') fail('سر الإعداد غير مضبوط على الخادم', 403);

    if (!hash_equals($expected, $given)) {
        error_log('setup: bad secret from ' . client_ip());
        fail('سر الإعداد غير صحيح', 403);
    }
}

function route_setup(string $method, string $path): void
{
    /* ---- إنشاء أول مالك ---- */
    if ($method === 'POST' && $path === '/setup-owner') {
        require_setup_secret();

        $b     = body();
        $email = strtolower(trim((string)($b['email'] ?? '')));
        $pass  = (string)($b['password'] ?? '');

        $existing = db_one("SELECT COUNT(*) AS c FROM users WHERE role = 'owner'");
        if ($existing && (int)$existing['c'] > 0) fail('يوجد Owner مسبقاً', 409);

        if (!preg_match('/^[^@\s]+@[^@\s]+\.[^@\s]+$/', $email)) fail('إيميل غير صالح', 400);
        if (strlen($pass) < 6) fail('كلمة السر 6 أحرف على الأقل', 400);

        // project_id = NULL: المالك وصوله شامل ولا يُقيَّد بمشروع
        db_run("INSERT INTO users (email,password,role,project_id) VALUES (?,?,'owner',NULL)",
            [$email, hash_password($pass)]);

        json_out(['ok' => true, 'message' => 'تم إنشاء حساب المالك']);
    }

    /* ---- تغيير إيميل المالك ---- */
    if ($method === 'POST' && $path === '/change-owner-email') {
        require_setup_secret();

        $newEmail = strtolower(trim((string)(body()['new_email'] ?? '')));
        if (!preg_match('/^[^@\s]+@[^@\s]+\.[^@\s]+$/', $newEmail)) fail('إيميل غير صالح', 400);

        $owner = db_one("SELECT email FROM users WHERE role = 'owner' LIMIT 1");
        if (!$owner) fail('لا يوجد Owner', 404);

        // نفحص التعارض أولاً: عمود email فريد، وإلا فشل القيد بخطأ 500 غامض
        $clash = db_one("SELECT email FROM users WHERE email = ? AND role <> 'owner'", [$newEmail]);
        if ($clash) fail('هذا الإيميل مستخدم لحساب آخر', 409);

        $old = (string)$owner['email'];

        $pdo = db();
        $pdo->beginTransaction();
        try {
            db_run("UPDATE users SET email = ? WHERE role = 'owner'", [$newEmail]);
            // الجلسات والروابط مرتبطة بالإيميل نصّاً لا بمفتاح، فتُنقل يدوياً
            db_run('DELETE FROM sessions WHERE email = ?', [$old]);         // يُخرجه ليدخل بالجديد
            db_run('UPDATE user_projects SET email = ? WHERE email = ?', [$newEmail, $old]);
            db_run('DELETE FROM login_attempts WHERE email = ?', [$old]);
            $pdo->commit();
        } catch (Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }

        json_out(['ok' => true, 'message' => 'تم تغيير إيميل المالك', 'new_email' => $newEmail]);
    }
}
