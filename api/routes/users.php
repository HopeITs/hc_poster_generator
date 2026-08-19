<?php
/**
 * /users · /users/add · /users/delete · /users/set-projects
 *
 * القواعد والرسائل ورموز الحالة منقولة حرفياً عن الـWorker، فالواجهة
 * لا تلاحظ أي فرق.
 */

declare(strict_types=1);

/** معرّفات مشاريع مستخدم — لفحص أن admin يمنح من ضمن مشاريعه فقط. */
function user_project_ids(string $email): array
{
    $rows = db_all('SELECT project_id FROM user_projects WHERE email = ?', [$email]);
    return array_map(fn($r) => (int)$r['project_id'], $rows);
}

/** يحوّل مدخلات المشاريع إلى مصفوفة أعداد صحيحة. */
function normalise_pids(array $b): array
{
    if (isset($b['project_ids']) && is_array($b['project_ids'])) {
        $raw = $b['project_ids'];
    } elseif (isset($b['project_id']) && $b['project_id'] !== null) {
        $raw = [$b['project_id']];
    } else {
        $raw = [];
    }
    $out = [];
    foreach ($raw as $x) {
        if (is_numeric($x)) $out[] = (int)$x;
    }
    return array_values(array_unique($out));
}

/** يتحقّق أن كل المشاريع موجودة، وأن غير الشامل يملكها. يوقف الطلب عند الفشل. */
function assert_projects_allowed(array $pids, array $actor): void
{
    foreach ($pids as $pid) {
        if (!db_one('SELECT id FROM projects WHERE id = ?', [$pid])) {
            fail("مشروع غير موجود ($pid)", 404);
        }
    }
    if (!is_global_role($actor['role'])) {
        $mine = user_project_ids($actor['email']);
        foreach ($pids as $pid) {
            if (!in_array($pid, $mine, true)) fail('لا صلاحية على أحد المشاريع المحدّدة', 403);
        }
    }
}

function route_users(string $method, string $path): void
{
    /* ---- قائمة المستخدمين ---- */
    if ($method === 'GET' && $path === '/users') {
        $actor = require_user();
        if (!can_manage($actor['role'])) fail('لا صلاحية', 403);

        $visible = roles_visible_to($actor['role']);
        if (!$visible) json_out(['ok' => true, 'users' => []]);

        $in   = implode(',', array_fill(0, count($visible), '?'));
        $rows = db_all(
            "SELECT email, role, created_at, project_id FROM users WHERE role IN ($in) ORDER BY created_at",
            $visible
        );

        $users = [];
        foreach ($rows as $u) {
            $users[] = [
                'email'      => $u['email'],
                'role'       => $u['role'],
                'created_at' => $u['created_at'],
                'projects'   => user_projects_brief((string)$u['email'], (string)$u['role']),
            ];
        }
        json_out(['ok' => true, 'users' => $users]);
    }

    /* ---- إضافة مستخدم ---- */
    if ($method === 'POST' && $path === '/users/add') {
        $actor = require_user();
        if (!can_manage($actor['role'])) fail('لا صلاحية', 403);

        $b     = body();
        $email = strtolower(trim((string)($b['email'] ?? '')));
        $role  = (string)($b['role'] ?? 'user');
        $pass  = (string)($b['password'] ?? '');

        if (!preg_match('/^[^@\s]+@[^@\s]+\.[^@\s]+$/', $email)) fail('إيميل غير صالح', 400);
        if (strlen($pass) < 4) fail('كلمة السر 4 أحرف على الأقل', 400);
        if (!can_assign($actor['role'], $role)) fail('لا يمكنك تعيين هذا الدور', 403);

        $pids = normalise_pids($b);
        if ($role === 'comms') {
            $pids = [];                      // comms وصوله شامل بلا مشاريع محدّدة
        } else {
            if (!$pids) fail('يجب اختيار مشروع واحد على الأقل', 400);
            assert_projects_allowed($pids, $actor);
        }

        if (db_one('SELECT email FROM users WHERE email = ?', [$email])) {
            fail('هذا الإيميل موجود مسبقاً', 409);
        }

        // معاملة واحدة: لا يبقى مستخدم بلا مشاريعه إن فشل إدراج وسطي
        $pdo = db();
        $pdo->beginTransaction();
        try {
            db_run('INSERT INTO users (email,password,role,project_id) VALUES (?,?,?,?)',
                [$email, hash_password($pass), $role, $pids[0] ?? null]);
            foreach ($pids as $pid) {
                db_run('INSERT IGNORE INTO user_projects (email,project_id) VALUES (?,?)', [$email, $pid]);
            }
            $pdo->commit();
        } catch (Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
        json_out(['ok' => true]);
    }

    /* ---- حذف مستخدم ---- */
    if ($method === 'POST' && $path === '/users/delete') {
        $actor = require_user();
        if (!can_manage($actor['role'])) fail('لا صلاحية', 403);

        $email  = strtolower(trim((string)(body()['email'] ?? '')));
        $target = db_one('SELECT email,role FROM users WHERE email = ?', [$email]);

        if (!$target)                                fail('المستخدم غير موجود', 404);
        if ($target['role'] === 'owner')             fail('لا يمكن حذف الـ Owner', 403);
        if ($target['email'] === $actor['email'])    fail('لا يمكنك حذف حسابك', 403);
        if (in_array($target['role'], ['admin', 'comms'], true) && $actor['role'] !== 'owner') {
            fail('فقط الـ Owner يحذف هذا الدور', 403);
        }

        $pdo = db();
        $pdo->beginTransaction();
        try {
            db_run('DELETE FROM users WHERE email = ?', [$email]);
            db_run('DELETE FROM sessions WHERE email = ?', [$email]);      // يُخرجه فوراً
            db_run('DELETE FROM user_projects WHERE email = ?', [$email]);
            db_run('DELETE FROM login_attempts WHERE email = ?', [$email]);
            $pdo->commit();
        } catch (Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
        json_out(['ok' => true]);
    }

    /* ---- تعديل مشاريع مستخدم ---- */
    if ($method === 'POST' && $path === '/users/set-projects') {
        $actor = require_user();
        if (!can_manage($actor['role'])) fail('لا صلاحية', 403);

        $b      = body();
        $email  = strtolower(trim((string)($b['email'] ?? '')));
        $pids   = normalise_pids($b);
        $target = db_one('SELECT email,role FROM users WHERE email = ?', [$email]);

        if (!$target) fail('المستخدم غير موجود', 404);
        if (in_array($target['role'], ['owner', 'comms'], true)) {
            fail('هذا الدور وصوله شامل ولا يُخصّص', 400);
        }
        if ($actor['role'] !== 'owner' && $target['role'] !== 'user') fail('فقط الـ Owner', 403);
        if (!$pids) fail('يجب اختيار مشروع واحد على الأقل', 400);
        assert_projects_allowed($pids, $actor);

        $pdo = db();
        $pdo->beginTransaction();
        try {
            db_run('DELETE FROM user_projects WHERE email = ?', [$email]);
            foreach ($pids as $pid) {
                db_run('INSERT IGNORE INTO user_projects (email,project_id) VALUES (?,?)', [$email, $pid]);
            }
            db_run('UPDATE users SET project_id = ? WHERE email = ?', [$pids[0], $email]);
            $pdo->commit();
        } catch (Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
        json_out(['ok' => true]);
    }
}
