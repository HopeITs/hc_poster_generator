<?php
/**
 * /login · /me · /logout
 *
 * الرد لا يحوي التوكن — الجلسة في كوكي HttpOnly. هذا الفارق الوحيد عن
 * الـWorker في شكل الرد، ويقتضي تعديلاً صغيراً في الواجهة عند التحويل.
 */

declare(strict_types=1);

function route_auth(string $method, string $path): void
{
    /* ---- تسجيل الدخول ---- */
    if ($method === 'POST' && $path === '/login') {
        $b     = body();
        $email = strtolower(trim((string)($b['email'] ?? '')));
        $ip    = client_ip();

        if (login_blocked($email, $ip)) {
            fail('محاولات كثيرة. حاول بعد ' . LOGIN_WINDOW_MIN . ' دقيقة.', 429);
        }

        $u = db_one('SELECT email,password,role,project_id,photo FROM users WHERE email = ?', [$email]);

        if (!$u || !verify_password((string)($b['password'] ?? ''), (string)$u['password'])) {
            record_login_failure($email, $ip);
            // رسالة واحدة للحالتين: لا نكشف أي الإيميلات مسجّلة
            fail('الإيميل أو كلمة السر غير صحيحة', 401);
        }

        clear_login_failures($email);
        start_session((string)$u['email'], !empty($b['remember']));

        $projects = accessible_projects((string)$u['email'], (string)$u['role']);
        json_out([
            'ok'   => true,
            'user' => [
                'email'      => $u['email'],
                'role'       => $u['role'],
                'project_id' => $u['project_id'] === null ? null : (int)$u['project_id'],
                'photo'      => $u['photo'],
            ],
            'projects' => $projects,
            'project'  => $projects[0] ?? null,
        ]);
    }

    /* ---- الجلسة الحالية ---- */
    if ($method === 'GET' && $path === '/me') {
        $me       = require_user();
        $projects = accessible_projects($me['email'], $me['role']);
        json_out([
            'ok'   => true,
            'user' => [
                'email'      => $me['email'],
                'role'       => $me['role'],
                'project_id' => $me['project_id'],
                'photo'      => $me['photo'],
            ],
            'projects' => $projects,
            'project'  => $projects[0] ?? null,
        ]);
    }

    /* ---- تسجيل الخروج ---- */
    if ($method === 'POST' && $path === '/logout') {
        end_session();          // آمن حتى لو لم تكن هناك جلسة
        json_out(['ok' => true]);
    }
}
