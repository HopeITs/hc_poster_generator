<?php
/**
 * بناء وإرسال رسائل MIME.
 *
 * لا Resend ولا أي خدمة خارجية: التسليم إلى خادم بريد الاستضافة نفسه عبر
 * جلسة SMTP موثّقة (smtp.php)، فتصدر الرسالة عن no-reply@hcsyria.org حقاً
 * وتُوقَّع بـDKIM النطاق.
 *
 * mail() باقية كخيار احتياطي فقط: تعمل حين يكون التطبيق على خادم البريد
 * نفسه، وتُستعمل تلقائياً إن لم تُضبط إعدادات smtp (كالتطوير المحلي).
 *
 * بناء الرسالة مفصول عن إرسالها ليبقى قابلاً للاختبار بلا خادم بريد.
 */

declare(strict_types=1);

/** يمنع حقن الرؤوس: سطر جديد في أي حقل يسمح للطالب بإضافة رؤوس خاصة به. */
function header_safe(string $s): string
{
    return str_replace(["\r", "\n"], ' ', $s);
}

/** ترميز RFC 2047 ليصل العنوان العربي سليماً. */
function encode_subject(string $subject): string
{
    return '=?UTF-8?B?' . base64_encode($subject) . '?=';
}

/**
 * يبني جسم الرسالة ورؤوسها.
 *
 * الرؤوس تُعاد كمصفوفة بلا To وSubject عمداً: mail() تضيفهما بنفسها من
 * معاملاتها، فإدراجهما هنا يُنتج رأسين مكرّرين. مسار SMTP يضيفهما في
 * send_mail لأن أمر DATA يتطلّب رسالة كاملة.
 *
 * @param array  $attachments عناصر [filename, content] والمحتوى base64 جاهز
 * @param string $replyTo     عنوان الرد — عادةً مُرسِل الطلب لا صندوق no-reply
 * @return array{0:string,1:string[]} [الجسم، الرؤوس]
 */
function build_mime(string $html, array $attachments, string $fromEmail, string $fromName, string $boundary, string $replyTo = ''): array
{
    $domain = substr(strrchr($fromEmail, '@') ?: '@localhost', 1);

    $headers = [
        'From: ' . header_safe($fromName) . ' <' . $fromEmail . '>',
        'Reply-To: ' . header_safe($replyTo !== '' ? $replyTo : $fromEmail),
        // Date وMessage-ID مطلوبان في RFC 5322. الـMTA يضيفهما حين تُستعمل
        // mail()، أما في SMTP المباشر فغيابهما يرفع تقييم السبام.
        'Date: ' . date('r'),
        'Message-ID: <' . bin2hex(random_bytes(16)) . '@' . $domain . '>',
        'MIME-Version: 1.0',
        'Content-Type: multipart/mixed; boundary="' . $boundary . '"',
    ];

    $body  = "--$boundary\r\n";
    $body .= "Content-Type: text/html; charset=UTF-8\r\n";
    $body .= "Content-Transfer-Encoding: base64\r\n\r\n";
    $body .= chunk_split(base64_encode($html)) . "\r\n";

    foreach ($attachments as $a) {
        // basename يمنع المسارات، وحذف الاقتباس يمنع الخروج من filename="..."
        // لإضافة معاملات إلى Content-Disposition
        $name = str_replace(['"', '\\'], '', basename(header_safe((string)($a['filename'] ?? 'file'))));
        if ($name === '') $name = 'file';
        $data = preg_replace('/\s+/', '', (string)($a['content'] ?? ''));
        // تخطّى المرفق إن لم يكن base64 سليماً بدل إفساد الرسالة كلها
        if ($data === '' || !preg_match('#^[A-Za-z0-9+/]+={0,2}$#', $data)) continue;

        $body .= "--$boundary\r\n";
        $body .= "Content-Type: application/octet-stream; name=\"$name\"\r\n";
        $body .= "Content-Disposition: attachment; filename=\"$name\"\r\n";
        $body .= "Content-Transfer-Encoding: base64\r\n\r\n";
        $body .= chunk_split($data) . "\r\n";
    }
    $body .= "--$boundary--\r\n";

    return [$body, $headers];
}

/**
 * يرسل الرسالة. يعيد false إن رفض التسليم — والسبب في سجل الأخطاء.
 *
 * @param string $replyTo عنوان الرد. الافتراضي صندوق المُرسِل نفسه.
 */
function send_mail(array $to, string $subject, string $html, array $attachments = [], string $replyTo = ''): bool
{
    $cfg  = config();
    $from = (string)($cfg['mail_from'] ?? '');
    $name = (string)($cfg['mail_from_name'] ?? '');
    if ($from === '' || !$to) return false;

    [$body, $headers] = build_mime(
        $html, $attachments, $from, $name, 'b' . bin2hex(random_bytes(16)), $replyTo
    );

    $encSubject = encode_subject(header_safe($subject));

    // إعدادات smtp موجودة => الخادم المشترك: نسلّم عبر جلسة موثّقة
    if (($cfg['smtp']['host'] ?? '') !== '') {
        $full = array_merge(
            ['To: ' . header_safe(implode(', ', $to)), 'Subject: ' . $encSubject],
            $headers
        );
        return smtp_send($from, $to, implode("\r\n", $full), $body);
    }

    // احتياطي: MTA محلي. -f يضبط مُرسِل المغلّف (Return-Path) الذي يفحصه SPF
    return mail(
        implode(', ', $to),
        $encSubject,
        $body,
        implode("\r\n", $headers),
        '-f' . $from
    );
}
