<?php
/**
 * قراءة المشاريع بالصيغة التي تتوقّعها الواجهة.
 *
 * brand_json مخزّن كنص، وتتوقّعه الواجهة كائناً باسم brand.
 */

declare(strict_types=1);

function project_shape(array $p): array
{
    $brand = json_decode((string)($p['brand_json'] ?? ''), true);
    return [
        'id'            => (int)$p['id'],
        'name'          => $p['name'],
        'slug'          => $p['slug'],
        'template_type' => $p['template_type'],
        'status'        => $p['status'],
        'brand'         => is_array($brand) ? $brand : new stdClass(),
    ];
}

function get_project(?int $id): ?array
{
    if ($id === null) return null;
    $row = db_one('SELECT id,name,slug,brand_json,template_type,status FROM projects WHERE id = ?', [$id]);
    return $row ? project_shape($row) : null;
}

/** المشاريع المتاحة لمستخدم: الكل للأدوار الشاملة، وإلا مشاريعه المرتبطة. */
function accessible_projects(string $email, string $role): array
{
    if (is_global_role($role)) {
        $rows = db_all('SELECT id,name,slug,brand_json,template_type,status FROM projects ORDER BY id');
    } else {
        $rows = db_all(
            'SELECT p.id,p.name,p.slug,p.brand_json,p.template_type,p.status
               FROM projects p
               JOIN user_projects up ON up.project_id = p.id
              WHERE up.email = ?
           ORDER BY p.id',
            [$email]
        );
    }
    return array_map('project_shape', $rows);
}

/** أسماء مشاريع مستخدم مختصرة، لعرضها في قائمة المستخدمين. */
function user_projects_brief(string $email, string $role): array
{
    if (is_global_role($role)) return [];
    $rows = db_all(
        'SELECT p.id,p.name FROM projects p
           JOIN user_projects up ON up.project_id = p.id
          WHERE up.email = ? ORDER BY p.id',
        [$email]
    );
    return array_map(fn($p) => ['id' => (int)$p['id'], 'name' => $p['name']], $rows);
}
