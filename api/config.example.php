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

    // المُرسِل في إشعارات /notify — صندوق حقيقي على هذا الخادم
    'mail_from'      => 'no-reply@hcsyria.org',
    'mail_from_name' => 'Hope Center',

    // true في الإنتاج: يمنع إرسال كوكي الجلسة عبر HTTP.
    // اجعلها false محلياً فقط إن كنت تطوّر بلا HTTPS.
    'cookie_secure' => true,
];
