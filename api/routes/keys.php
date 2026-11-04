<?php
/**
 * /keys · /keys/add · /keys/delete — مفاتيح API للبرامج الخارجية.
 *
 * المفتاح يعمل بصلاحيات صاحبه، ويُرسَل في Authorization: Bearer أو X-API-Key.
 * إدارة المفاتيح بجلسة متصفح فقط (require_session)، لا بمفتاح.
 *
 * owner يرى ويلغي كل المفاتيح؛ admin و comms مفاتيحهم فقط؛ user لا مفاتيح له.
 */

declare(strict_types=1);

const API_KEY_SCOPES   = ['read', 'write'];
const API_KEYS_PER_USER = 10;

function route_keys(string $method, string $path): void
{
    /* ---- القائمة ---- */
    if ($method === 'GET' && $path === '/keys') {
        $me = require_session();
        if (!can_manage($me['role'])) fail('لا صلاحية', 403);

        $cols = 'id, email, name, prefix, scope, created_at, expires_at, last_used_at';
        $rows = $me['role'] === 'owner'
            ? db_all("SELECT $cols FROM api_keys ORDER BY created_at DESC")
            : db_all("SELECT $cols FROM api_keys WHERE email = ? ORDER BY created_at DESC", [$me['email']]);

        json_out(['ok' => true, 'keys' => array_map(fn($r) => ['id' => (int)$r['id']] + $r, $rows)]);
    }

    /* ---- إنشاء مفتاح ---- */
    if ($method === 'POST' && $path === '/keys/add') {
        $me = require_session();
        if (!can_manage($me['role'])) fail('لا صلاحية', 403);

        $b     = body();
        $name  = mb_substr(trim((string)($b['name'] ?? '')), 0, 100);
        $scope = (string)($b['scope'] ?? 'read');
        $days  = $b['days'] ?? null;

        if ($name === '') fail('اسم المفتاح مطلوب', 400);
        if (!in_array($scope, API_KEY_SCOPES, true)) fail('الصلاحية read أو write', 400);
        if ($days !== null && (!is_int($days) || $days < 1 || $days > 3650)) {
            fail('مدة الصلاحية بالأيام بين 1 و 3650', 400);
        }

        $count = db_one('SELECT COUNT(*) AS n FROM api_keys WHERE email = ?', [$me['email']]);
        if ((int)$count['n'] >= API_KEYS_PER_USER) {
            fail('وصلت إلى الحد الأقصى (' . API_KEYS_PER_USER . ' مفاتيح). ألغِ مفتاحاً قديماً أولاً', 409);
        }

        $key     = make_api_key();
        $prefix  = substr($key, 0, 12);
        $expires = $days === null ? null : gmdate('Y-m-d H:i:s', time() + $days * 86400);

        // created_at صريح بـUTC كبقية الأوقات، لا CURRENT_TIMESTAMP بتوقيت الخادم
        db_run(
            'INSERT INTO api_keys (email, name, key_hash, prefix, scope, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [$me['email'], $name, api_key_hash($key), $prefix, $scope, gmdate('Y-m-d H:i:s'), $expires]
        );

        // المرة الوحيدة التي يظهر فيها المفتاح: لا يُخزَّن نصّه فلا يُستعاد
        json_out([
            'ok'         => true,
            'id'         => (int)db()->lastInsertId(),
            'key'        => $key,
            'name'       => $name,
            'scope'      => $scope,
            'expires_at' => $expires,
        ], 201);
    }

    /* ---- إلغاء مفتاح ---- */
    if ($method === 'POST' && $path === '/keys/delete') {
        $me = require_session();
        if (!can_manage($me['role'])) fail('لا صلاحية', 403);

        $id  = (int)(body()['id'] ?? 0);
        $row = db_one('SELECT email FROM api_keys WHERE id = ?', [$id]);

        // 404 لمفتاح غيرك أيضاً: لا يُكشف وجود مفاتيح الآخرين
        if (!$row || ($me['role'] !== 'owner' && $row['email'] !== $me['email'])) {
            fail('المفتاح غير موجود', 404);
        }

        db_run('DELETE FROM api_keys WHERE id = ?', [$id]);
        json_out(['ok' => true]);
    }
}
