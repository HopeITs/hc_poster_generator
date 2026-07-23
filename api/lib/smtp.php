<?php
/**
 * عميل SMTP بلا أي اعتمادية خارجية.
 *
 * لماذا لا mail()؟ التطبيق على استضافة مشتركة، وهناك تُجرَّد mail() غالباً من
 * معامل ‎-f‎ فيصير المُرسِل في المغلّف حساب اللوحة لا no-reply@hcsyria.org،
 * فيسقط SPF ولا يُوقَّع DKIM. التسليم عبر جلسة SMTP موثّقة إلى خادم البريد
 * نفسه يجعل الرسالة صادرة عن الصندوق الحقيقي، وهو أفضل وضع ممكن للوصول.
 *
 * لا Composer ولا PHPMailer: هذا الملف يبني الجلسة كاملة في ~١٦٠ سطراً،
 * والمشروع كله بلا أطر عمل عمداً.
 *
 * هذا الملف ينقل البايتات فقط؛ بناء الرسالة في mail.php.
 */

declare(strict_types=1);

/**
 * يقرأ رد الخادم — قد يكون متعدّد الأسطر.
 *
 * الصيغة في RFC 5321: "250-النص" يعني أن سطراً تالياً قادم، و"250 النص"
 * (مسافة) يعني آخر سطر. قراءة سطر واحد فقط تترك بقية الرد في المخزن
 * فيُقرأ خطأً كردٍّ على الأمر التالي.
 *
 * @return array{0:int,1:string} [الرمز، نص الرد كاملاً]
 */
function smtp_read($fp): array
{
    $lines = [];
    while (($line = fgets($fp, 1024)) !== false) {
        $lines[] = rtrim($line, "\r\n");
        // أقل من 4 محارف = رد مشوّه؛ نتوقّف بدل الدوران إلى أن تنتهي المهلة
        if (strlen($line) < 4 || $line[3] !== '-') break;
    }
    if (!$lines) return [0, ''];
    return [(int)substr($lines[count($lines) - 1], 0, 3), implode("\n", $lines)];
}

/**
 * يكتب كل البايتات.
 *
 * fwrite قد تكتب جزءاً فقط حين يمتلئ مخزن المقبس — وهذا يحدث فعلاً مع
 * المرفقات (بوستر base64 بحجم ميغابايتات). الكتابة مرة واحدة بلا حلقة
 * تقطع الرسالة في منتصفها فيرفضها الخادم.
 */
function smtp_write($fp, string $data): bool
{
    $len = strlen($data);
    for ($sent = 0; $sent < $len;) {
        $n = fwrite($fp, substr($data, $sent));
        if ($n === false || $n === 0) return false;
        $sent += $n;
    }
    return true;
}

/**
 * يرسل أمراً وينتظر رمزاً متوقّعاً.
 *
 * $label يظهر في السجل بدل الأمر نفسه، حتى لا تُسجَّل كلمة السر في
 * خطوة AUTH.
 */
function smtp_cmd($fp, string $cmd, array $expect, string $label): bool
{
    if (!smtp_write($fp, $cmd . "\r\n")) {
        error_log("smtp: write failed at $label");
        return false;
    }
    [$code, $text] = smtp_read($fp);
    if (!in_array($code, $expect, true)) {
        // نص الخادم هو ما يشرح سبب الرفض فعلاً (حصة، توثيق، ترحيل ممنوع)
        error_log("smtp: $label expected " . implode('/', $expect) . ", got $code: $text");
        return false;
    }
    return true;
}

/** يضاعف النقطة في أول السطر — وإلا أنهت سطراً كهذا الرسالةَ مبكراً. */
function smtp_dot_stuff(string $data): string
{
    // توحيد نهايات الأسطر أولاً: SMTP يتطلّب CRLF، وbase64 هنا يستعمل \n
    $data = preg_replace('/\r\n|\r|\n/', "\r\n", $data);
    return preg_replace('/^\./m', '..', $data);
}

/**
 * يفتح جلسة SMTP ويسلّم الرسالة.
 *
 * @param string $from    مُرسِل المغلّف (Return-Path) — ما يفحصه SPF
 * @param array  $to      مستلمو المغلّف
 * @param string $headers الرؤوس كاملة بما فيها To وSubject
 * @param string $body    جسم MIME
 */
function smtp_send(string $from, array $to, string $headers, string $body): bool
{
    $c    = (array)(config()['smtp'] ?? []);
    $host = (string)($c['host'] ?? '');
    if ($host === '' || !$to) return false;

    $port    = (int)($c['port'] ?? 465);
    $secure  = strtolower((string)($c['secure'] ?? 'ssl'));   // ssl | tls | none
    $user    = (string)($c['user'] ?? '');
    $pass    = (string)($c['pass'] ?? '');
    $timeout = (int)($c['timeout'] ?? 20);
    // بعض الخوادم ترفض HELO باسم غير مؤهَّل؛ نطاق المُرسِل خيار آمن
    $helo    = (string)($c['helo'] ?? (substr(strrchr($from, '@') ?: '@localhost', 1)));

    // ssl:// = TLS من أول بايت (منفذ 465). أما 'tls' فيبدأ نصّاً ثم يرقّي
    // بـSTARTTLS (منفذ 587)، وهو البديل إن كان 465 محجوباً.
    $scheme = $secure === 'ssl' ? 'ssl://' : 'tcp://';

    // التحقّق من الشهادة مُفعَّل: بدونه يستطيع أي وسيط انتحال خادم البريد
    // والتقاط كلمة سر الصندوق.
    $ctx = stream_context_create(['ssl' => [
        'verify_peer'      => true,
        'verify_peer_name' => true,
        'SNI_enabled'      => true,
    ]]);

    $fp = @stream_socket_client(
        $scheme . $host . ':' . $port, $errno, $errstr,
        $timeout, STREAM_CLIENT_CONNECT, $ctx
    );
    if (!$fp) {
        error_log("smtp: connect to $host:$port failed ($errno) $errstr");
        return false;
    }
    // بلا مهلة قراءة، خادم صامت يعلّق الطلب إلى أن يقتله PHP
    stream_set_timeout($fp, $timeout);

    $bail = function (string $why) use ($fp): bool {
        if ($why !== '') error_log('smtp: ' . $why);
        @fclose($fp);
        return false;
    };

    [$code, $greet] = smtp_read($fp);
    if ($code !== 220) return $bail("greeting was $code: $greet");

    if (!smtp_cmd($fp, "EHLO $helo", [250], 'EHLO')) return $bail('');

    if ($secure === 'tls') {
        if (!smtp_cmd($fp, 'STARTTLS', [220], 'STARTTLS')) return $bail('');
        if (!stream_socket_enable_crypto($fp, true, STREAM_CRYPTO_METHOD_TLS_CLIENT)) {
            return $bail('STARTTLS handshake failed');
        }
        // EHLO يُعاد بعد الترقية: القدرات قبل TLS غير موثوقة
        if (!smtp_cmd($fp, "EHLO $helo", [250], 'EHLO(tls)')) return $bail('');
    }

    if ($user !== '') {
        // AUTH LOGIN: اسم ثم كلمة، كلٌّ بـbase64، والخادم يردّ 334 بينهما
        if (!smtp_cmd($fp, 'AUTH LOGIN', [334], 'AUTH')) return $bail('');
        if (!smtp_cmd($fp, base64_encode($user), [334], 'AUTH user')) return $bail('');
        if (!smtp_cmd($fp, base64_encode($pass), [235], 'AUTH pass')) return $bail('');
    }

    if (!smtp_cmd($fp, "MAIL FROM:<$from>", [250], 'MAIL FROM')) return $bail('');

    // 251 = يقبله ويحوّله. رفض مستلم واحد لا يلغي الباقين.
    $accepted = 0;
    foreach ($to as $rcpt) {
        if (smtp_cmd($fp, "RCPT TO:<$rcpt>", [250, 251], 'RCPT')) $accepted++;
    }
    if ($accepted === 0) return $bail('every recipient was rejected');

    if (!smtp_cmd($fp, 'DATA', [354], 'DATA')) return $bail('');

    $data = smtp_dot_stuff($headers . "\r\n\r\n" . $body);
    if (!smtp_write($fp, $data . "\r\n.\r\n")) return $bail('write failed during DATA');

    [$code, $text] = smtp_read($fp);
    if ($code !== 250) return $bail("message rejected: $code $text");

    // QUIT مجاملة؛ الرسالة قُبلت أصلاً في السطر السابق فلا نفحص رده
    @smtp_write($fp, "QUIT\r\n");
    @fclose($fp);
    return true;
}
