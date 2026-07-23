<?php
/**
 * /notify — إشعار بمشروع جديد مع المرفقات.
 *
 * المستلمون من الإعدادات (notify_to) لا من الطلب: لا يمكن استعمال هذه
 * النقطة لإرسال بريد إلى أي عنوان يختاره الطالب.
 *
 * كانت القائمة تُحسب من قاعدة البيانات (كل owner و comms)، فكان إضافة
 * مستخدم بأحد الدورين يغيّر وجهة البريد ضمناً. صارت الوجهة صريحة.
 */

declare(strict_types=1);

function route_notify(string $method, string $path): void
{
    if ($method !== 'POST' || $path !== '/notify') return;

    $me = require_user();
    $b  = body();

    $title = mb_substr(trim((string)($b['title'] ?? '')) ?: 'مشروع بدون عنوان', 0, 120);

    // اسم المشروع من الطلب، وإلا من مشروع المُرسِل
    $projName = trim((string)($b['project_name'] ?? ''));
    if ($projName === '') {
        $p = get_project($me['project_id']);
        $projName = $p['name'] ?? 'STUDY ZONE';
    }

    $recipients = array_values(array_filter(array_map(
        fn($e) => filter_var(trim((string)$e), FILTER_VALIDATE_EMAIL),
        (array)(config()['notify_to'] ?? [])
    )));
    // 500 لا 400: الخطأ في إعداد الخادم، والطالب لا يستطيع تصحيحه
    if (!$recipients) fail('لا يوجد مستلمون مضبوطون على الخادم', 500);

    $when = gmdate('Y-m-d H:i:s') . ' UTC';
    // htmlspecialchars: اسم المشروع والعنوان يأتيان من المستخدم
    $e = fn(string $s) => htmlspecialchars($s, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');

    $html = "<div style='font-family:Arial,sans-serif;direction:rtl;text-align:right'>"
          . '<h2 style="color:#003c54">مشروع جديد من ' . $e($projName) . '</h2>'
          . '<p><b>المشروع:</b> ' . $e($projName) . '</p>'
          . '<p><b>العنوان:</b> ' . $e($title) . '</p>'
          . '<p><b>أنشأه:</b> ' . $e($me['email']) . '</p>'
          . '<p><b>التوقيت:</b> ' . $e($when) . '</p>'
          . '<p>الملفات مرفقة بهذا الإيميل (البوستر، الستوري، ملف المشروع).</p>'
          . '</div>';

    // الواجهة ترسل [{filename, b64}] — نطبّعها إلى ما يتوقّعه build_mime
    $attachments = [];
    foreach ((array)($b['attachments'] ?? []) as $a) {
        if (!is_array($a)) continue;
        $attachments[] = [
            'filename' => (string)($a['filename'] ?? 'file'),
            'content'  => (string)($a['b64'] ?? $a['content'] ?? ''),
        ];
    }

    $subject = 'مشروع جديد: ' . $title . ' — ' . $projName . ' — ' . $me['email'];

    // الرد على الإشعار يصل إلى من أرسل الطلب، لا إلى صندوق no-reply
    $replyTo = (string)(filter_var($me['email'], FILTER_VALIDATE_EMAIL) ?: '');

    if (!send_mail($recipients, $subject, $html, $attachments, $replyTo)) {
        // سبب الرفض يظهر في سجل بريد الخادم، لا في الرد
        error_log('notify: mail() refused delivery to ' . implode(',', $recipients));
        fail('تعذّر إرسال البريد — راجع سجل البريد على الخادم', 502);
    }

    json_out(['ok' => true, 'recipients' => count($recipients)]);
}
