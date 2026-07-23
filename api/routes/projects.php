<?php
/**
 * /projects · /projects/add · /projects/update
 *
 * الإنشاء والتعديل للـowner وحده. القراءة لأي مستخدم مسجّل، ومفلترة
 * حسب دوره في accessible_projects().
 */

declare(strict_types=1);

function route_projects(string $method, string $path): void
{
    /* ---- المشاريع المتاحة للمستخدم الحالي ---- */
    if ($method === 'GET' && $path === '/projects') {
        $me = require_user();
        json_out(['ok' => true, 'projects' => accessible_projects($me['email'], $me['role'])]);
    }

    /* ---- إنشاء مشروع ---- */
    if ($method === 'POST' && $path === '/projects/add') {
        $me = require_user();
        if ($me['role'] !== 'owner') fail('فقط الـ Owner ينشئ مشاريع', 403);

        $b     = body();
        $name  = trim((string)($b['name'] ?? ''));
        $slug  = strtolower(trim((string)($b['slug'] ?? '')));
        $type  = trim((string)($b['template_type'] ?? 'studyzone_v1'));
        $brand = $b['brand'] ?? [];

        if ($name === '' || $slug === '') fail('الاسم والمعرّف (slug) مطلوبان', 400);
        if (!preg_match('/^[a-z0-9-]+$/', $slug)) {
            fail('المعرّف: أحرف إنجليزية صغيرة وأرقام وشرطات فقط', 400);
        }
        if (db_one('SELECT id FROM projects WHERE slug = ?', [$slug])) {
            fail('هذا المعرّف مستخدم مسبقاً', 409);
        }

        db_run(
            'INSERT INTO projects (name, slug, brand_json, template_type) VALUES (?,?,?,?)',
            [$name, $slug, json_encode($brand, JSON_UNESCAPED_UNICODE), $type]
        );
        json_out(['ok' => true]);
    }

    /* ---- تعديل مشروع ---- */
    if ($method === 'POST' && $path === '/projects/update') {
        $me = require_user();
        if ($me['role'] !== 'owner') fail('فقط الـ Owner يعدّل المشاريع', 403);

        $b    = body();
        $slug = strtolower(trim((string)($b['slug'] ?? '')));
        if ($slug === '') fail('المعرّف (slug) مطلوب', 400);

        $p = db_one('SELECT id,name,brand_json,template_type FROM projects WHERE slug = ?', [$slug]);
        if (!$p) fail('المشروع غير موجود', 404);

        // الحقول الغائبة تبقى على حالها — تعديل جزئي لا استبدال كامل
        $name  = array_key_exists('name', $b) && $b['name'] !== null
               ? trim((string)$b['name']) : $p['name'];
        $type  = array_key_exists('template_type', $b) && $b['template_type'] !== null
               ? trim((string)$b['template_type']) : $p['template_type'];
        $brand = array_key_exists('brand', $b) && $b['brand'] !== null
               ? json_encode($b['brand'], JSON_UNESCAPED_UNICODE) : $p['brand_json'];

        db_run('UPDATE projects SET name = ?, brand_json = ?, template_type = ? WHERE slug = ?',
            [$name, $brand, $type, $slug]);
        json_out(['ok' => true]);
    }
}
