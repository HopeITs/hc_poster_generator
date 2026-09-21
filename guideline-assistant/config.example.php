<?php
/**
 * قالب إعدادات Guidelines Assistant.
 * انسخ هذا الملف إلى config.php واملأ السرّ المشترك. config.php مُستثنى من git.
 * ملفّ .php (يُنفَّذ ولا يُخدَم كنصّ)، فالسرّ لا يتسرّب عبر HTTP.
 *
 * GA_SHARED_SECRET: سرّ مشترك خادم-لخادم مع الـWorker (studyzone-auth)؛
 *   خزّنه في الـWorker بـ:  printf "%s" "<السرّ>" | npx wrangler secret put GA_SHARED_SECRET
 * WORKER_URL: عنوان الـWorker (اختياريّ — له قيمة افتراضيّة في الكود).
 */
return [
    'GA_SHARED_SECRET' => '',
    'WORKER_URL'       => 'https://studyzone-auth.ct-aleppo3.workers.dev',
];
