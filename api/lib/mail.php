<?php
/**
 * بناء وإرسال رسائل MIME عبر الـMTA المحلي.
 *
 * لا Resend ولا SMTP ولا جسر HTTP: هذا الكود يعمل على خادم البريد نفسه،
 * فـmail() تسلّم مباشرة إلى الـMTA وترث توقيع DKIM المضبوط على الخادم.
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
 * @param array $attachments عناصر [filename, content] والمحتوى base64 جاهز
 * @return array{0:string,1:string} [الجسم، الرؤوس]
 */
function build_mime(string $html, array $attachments, string $fromEmail, string $fromName, string $boundary): array
{
    $headers = implode("\r\n", [
        'From: ' . header_safe($fromName) . ' <' . $fromEmail . '>',
        'Reply-To: ' . $fromEmail,
        'MIME-Version: 1.0',
        'Content-Type: multipart/mixed; boundary="' . $boundary . '"',
    ]);

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

/** يرسل عبر الـMTA المحلي. يعيد false إن رفض التسليم. */
function send_mail(array $to, string $subject, string $html, array $attachments = []): bool
{
    $cfg  = config();
    $from = (string)($cfg['mail_from'] ?? '');
    $name = (string)($cfg['mail_from_name'] ?? '');
    if ($from === '') return false;

    [$body, $headers] = build_mime(
        $html, $attachments, $from, $name, 'b' . bin2hex(random_bytes(16))
    );

    // -f يضبط عنوان المُرسِل في المغلّف (Return-Path)، وهو ما يفحصه SPF
    return mail(
        implode(', ', $to),
        encode_subject(header_safe($subject)),
        $body,
        $headers,
        '-f' . $from
    );
}
