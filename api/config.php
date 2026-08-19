<?php
// إعدادات تطوير محلية فقط — هذا الملف مستثنى من Git
return [
    'db' => ['host'=>'127.0.0.1','name'=>'postgen_dev','user'=>'root','pass'=>'','charset'=>'utf8mb4'],
    'setup_secret'   => 'dev-only-not-a-real-secret',
    'mail_from'      => 'no-reply@hcsyria.org',
    'mail_from_name' => 'Hope Center',
    'notify_to'      => ['hekmat.jouby@hcsyria.org'],
    'smtp' => [
        'host'    => 'mail.s1893.sureserver.com',
        'port'    => 465,
        'secure'  => 'ssl',
        'user'    => 'no-reply@hcsyria.org',
        'pass'    => 'v{U}WjkEugcN',
        'timeout' => 20,
    ],
    'cookie_secure'  => false,   // التطوير المحلي عبر http
];
