<?php
/**
 * ردود JSON وقراءة الطلب.
 *
 * الصيغة مطابقة لما كان الـWorker يرجعه، حتى لا تحتاج الواجهة أي تعديل:
 * نجاح  => {"ok":true, ...}
 * فشل   => {"error":"..."} مع رمز حالة مناسب
 */

declare(strict_types=1);

/** يرسل JSON وينهي الطلب. */
function json_out(array $payload, int $status = 200): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    // JSON_UNESCAPED_UNICODE ليصل النص العربي مقروءاً لا كرموز \uXXXX
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

/** خطأ بصيغة الـWorker نفسها. */
function fail(string $message, int $status): never
{
    json_out(['error' => $message], $status);
}

/** جسم الطلب كمصفوفة. يعيد مصفوفة فارغة إن لم يكن JSON صالحاً. */
function body(): array
{
    static $cached = null;
    if ($cached !== null) return $cached;

    $raw = file_get_contents('php://input');
    $data = json_decode($raw ?: '', true);
    return $cached = is_array($data) ? $data : [];
}

/** عنوان IP للطالب — يُستعمل في حظر محاولات الدخول. */
function client_ip(): string
{
    // ملاحظة: لا نثق برؤوس X-Forwarded-* إلا خلف وسيط نتحكّم به،
    // وإلا استطاع أي طالب انتحال عنوانه وتجاوز الحظر.
    return (string)($_SERVER['REMOTE_ADDR'] ?? '');
}
