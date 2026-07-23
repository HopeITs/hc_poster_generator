<?php
/**
 * انسخ هذا الملف إلى config.php واملأه على الخادم.
 * config.php مستثنى من Git — لا تضع بيانات حقيقية هنا.
 */
return [
    'db' => [
        'host'     => '127.0.0.1',
        'name'     => 'postgen',
        'user'     => 'postgen',
        'pass'     => '',
        'charset'  => 'utf8mb4',
    ],

    // يحمي /setup-owner و /change-owner-email. ولّده بـ: openssl rand -hex 32
    'setup_secret' => '',

    // المُرسِل في إشعارات /notify — صندوق حقيقي على خادم البريد
    'mail_from'      => 'no-reply@hcsyria.org',
    'mail_from_name' => 'Hope Center',

    // وجهة إشعارات /notify. الطلب لا يقبل مستلمين، فهذه القائمة وحدها
    // تحدّد إلى أين يذهب البريد.
    'notify_to' => ['hekmat.jouby@hcsyria.org'],

    // خادم البريد في لوحة الاستضافة. احذف المفتاح كله (أو أفرغ host)
    // لتعود mail() المحلية — وهو المناسب للتطوير على XAMPP.
    'smtp' => [
        'host'    => 'mail.s1893.sureserver.com',
        // 465 مع secure=ssl، أو 587 مع secure=tls إن كان 465 محجوباً
        'port'    => 465,
        'secure'  => 'ssl',                      // ssl | tls | none
        'user'    => 'no-reply@hcsyria.org',
        'pass'    => '',                         // كلمة سر الصندوق
        'timeout' => 20,
    ],

    // true في الإنتاج: يمنع إرسال كوكي الجلسة عبر HTTP.
    // اجعلها false محلياً فقط إن كنت تطوّر بلا HTTPS.
    'cookie_secure' => true,
];
