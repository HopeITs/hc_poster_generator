<?php
/**
 * /me/photo · /me/photo/delete
 *
 * الصورة تُخزَّن كـdata URL في users.photo، كما كانت في D1. الإيميل يؤخذ
 * من الجلسة لا من جسم الطلب، فلا يستطيع مستخدم تعديل صورة غيره.
 *
 * الحذف بـPOST لا DELETE إبقاءً على تطابق الواجهة مع ما كان في الـWorker،
 * حيث كان cors() يسمح بـ GET/POST/OPTIONS فقط.
 */

declare(strict_types=1);

const PHOTO_MAX_BYTES = 300 * 1024;   // الواجهة تصغّر إلى 256×256 (~8KB)
const PHOTO_PATTERN   = '#^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$#';

function route_photo(string $method, string $path): void
{
    if ($method === 'POST' && $path === '/me/photo') {
        $me    = require_user();
        $photo = (string)(body()['photo'] ?? '');

        if (!preg_match(PHOTO_PATTERN, $photo)) fail('صيغة الصورة غير مدعومة', 400);
        if (strlen($photo) > PHOTO_MAX_BYTES)   fail('حجم الصورة كبير جداً', 413);

        // تحقّق فعلي من المحتوى: النمط أعلاه يثبت الشكل لا أن البايتات صورة
        $bin = base64_decode(substr($photo, strpos($photo, ',') + 1), true);
        if ($bin === false || @getimagesizefromstring($bin) === false) {
            fail('الملف ليس صورة صالحة', 400);
        }

        db_run('UPDATE users SET photo = ? WHERE email = ?', [$photo, $me['email']]);
        json_out(['ok' => true, 'photo' => $photo]);
    }

    if ($method === 'POST' && $path === '/me/photo/delete') {
        $me = require_user();
        db_run('UPDATE users SET photo = NULL WHERE email = ?', [$me['email']]);
        json_out(['ok' => true]);
    }
}
