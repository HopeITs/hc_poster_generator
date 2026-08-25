<?php
/**
 * قواعد الأدوار — منقولة حرفياً عن الـWorker حتى لا يتغيّر أي سلوك.
 *
 * owner : كل شيء
 * comms : وصول شامل للمشاريع، ويدير مستخدمي user فقط
 * admin : مقيّد بمشاريعه، ويدير مستخدمي user فقط
 * user  : توليد فقط
 */

declare(strict_types=1);

const ROLES = ['owner', 'admin', 'comms', 'user'];

function can_manage(string $role): bool
{
    return in_array($role, ['owner', 'admin', 'comms'], true);
}

/** وصول شامل لكل المشاريع بلا حاجة إلى user_projects. */
function is_global_role(string $role): bool
{
    return $role === 'owner' || $role === 'comms';
}

/** الأدوار التي يحق لهذا الدور رؤيتها في قائمة المستخدمين. */
function roles_visible_to(string $role): array
{
    if ($role === 'owner') return ROLES;
    if ($role === 'comms') return ['user', 'admin']; // Comms يدير الـ users والـ admins
    if ($role === 'admin') return ['user'];
    return [];
}

/** هل يملك $actor صلاحية إدارة (تعديل/حذف) دور $target؟
 *  owner: الكل عدا owner | comms: user + admin | admin: user */
function can_target(string $actor, string $target): bool
{
    if ($target === 'owner') return false;
    if ($target === 'comms') return $actor === 'owner';
    if ($target === 'admin') return $actor === 'owner' || $actor === 'comms';
    if ($target === 'user')  return in_array($actor, ['owner', 'admin', 'comms'], true);
    return false;
}

/** هل يحق لصاحب $actor إنشاء مستخدم بدور $target؟ */
function can_assign(string $actor, string $target): bool
{
    if ($actor === 'owner') return in_array($target, ['user', 'admin', 'comms'], true);
    if ($actor === 'admin' || $actor === 'comms') return $target === 'user';
    return false;
}
