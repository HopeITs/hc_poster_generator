<?php
/**
 * Guidelines Assistant — المرحلة 2: المعالجة (تدقيق + تصنيف الأدوار)
 * -----------------------------------------------------------------
 * يستدعي Gemini. المفتاح يُقرأ من متغيّر البيئة GEMINI_API_KEY فقط
 * (لا يُكتب في أي ملفّ ولا في الـgit).
 *
 * - ga_process_paragraphs(): للنصّ/الـdocx (بعد الاستخراج المحليّ).
 * - ga_vision_extract():     للصورة/الـPDF (استخراج + تصحيح + تصنيف بنداء واحد).
 */

declare(strict_types=1);

const GA_MODEL = 'gemini-flash-lite-latest';

/** الأدوار القانونيّة (مطابقة لأنماط Template.docx). */
const GA_ROLES = ['عنوان رئيسي', 'عنوان فرعي', 'نص', 'تعداد ناعم', 'تعداد خشن'];

function ga_key(): string
{
    return (string)(getenv('GEMINI_API_KEY') ?: '');
}

/** يوحّد اسم الدور القادم من النموذج إلى أحد الأدوار القانونيّة. */
function ga_norm_role($r): string
{
    $r = str_replace('_', ' ', trim((string)$r));
    return in_array($r, GA_ROLES, true) ? $r : 'نص';
}

/** نداء Gemini عامّ: يُعيد نصّ المرشّح الأول، أو يرمي استثناءً. */
function ga_gemini_call(array $payload, string $key): string
{
    $ch = curl_init("https://generativelanguage.googleapis.com/v1beta/models/" . GA_MODEL . ":generateContent");
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'x-goog-api-key: ' . $key],
        CURLOPT_POSTFIELDS => json_encode($payload, JSON_UNESCAPED_UNICODE),
        CURLOPT_TIMEOUT => 90,
    ]);
    $body = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $cerr = curl_error($ch);
    curl_close($ch);

    if ($body === false) {
        throw new RuntimeException('تعذّر الاتصال بخدمة الذكاء الاصطناعي: ' . $cerr);
    }
    $d = json_decode($body, true);
    if ($code !== 200) {
        $msg = $d['error']['message'] ?? ('HTTP ' . $code);
        throw new RuntimeException('فشل المعالجة: ' . $msg);
    }
    $txt = $d['candidates'][0]['content']['parts'][0]['text'] ?? '';
    if ($txt === '') {
        throw new RuntimeException('ردّ فارغ من خدمة المعالجة');
    }
    return $txt;
}

/**
 * يدقّق ويصنّف فقرات نصّية.
 * $paras: [ ['i'=>int, 'text'=>string], ... ]
 * يُعيد خريطة i => ['role'=>..., 'text'=>...]
 */
function ga_process_paragraphs(array $paras, string $key): array
{
    if (!$paras) return [];

    $sys =
"You format Arabic documents into the Hope Center house style.\n" .
"Input: JSON {\"items\":[{\"i\",\"text\"}]}.\n" .
"For EACH item: (1) lightly correct spelling, punctuation, spacing and obvious grammar WITHOUT changing meaning; " .
"keep proper nouns, places and organisations unchanged; keep numbers and dates EXACTLY as written — same digits, same order, same separators (do NOT reorder day/month/year) — only converting Indic numerals ٠-٩ to Western 0-9.\n" .
"(2) assign exactly ONE role from this CLOSED set:\n" .
"  عنوان_رئيسي = the document main title\n" .
"  عنوان_فرعي = a section heading / subtitle\n" .
"  نص = a normal body paragraph\n" .
"  تعداد_ناعم = a plain list item / minor point\n" .
"  تعداد_خشن = an emphasized list item / key point\n" .
"Return ONLY JSON {\"items\":[{\"i\",\"role\",\"text\"}]} with the SAME i values. No commentary.";

    $payload = [
        'system_instruction' => ['parts' => [['text' => $sys]]],
        'contents' => [['role' => 'user', 'parts' => [['text' => json_encode(['items' => $paras], JSON_UNESCAPED_UNICODE)]]]],
        'generationConfig' => ['temperature' => 0.2, 'responseMimeType' => 'application/json'],
    ];
    $txt = ga_gemini_call($payload, $key);
    $parsed = json_decode($txt, true);
    if (!is_array($parsed) || !isset($parsed['items'])) {
        throw new RuntimeException('ردّ التصنيف غير صالح');
    }
    $out = [];
    foreach ($parsed['items'] as $it) {
        if (!isset($it['i'])) continue;
        $out[(int)$it['i']] = [
            'role' => ga_norm_role($it['role'] ?? 'نص'),
            'text' => (string)($it['text'] ?? ''),
        ];
    }
    return $out;
}

/**
 * استخراج + تصحيح + تصنيف من صورة أو PDF بنداء واحد (متعدّد الوسائط).
 * يُعيد قائمة كتل: [ ['type'=>'para','role'=>..,'text'=>..] , ['type'=>'table','rows'=>[[..]]] ]
 */
function ga_vision_extract(string $path, string $mime, string $key): array
{
    $bytes = file_get_contents($path);
    if ($bytes === false) throw new RuntimeException('تعذّرت قراءة الملف');

    $sys =
"You read an Arabic document (image or PDF) and return its CONTENT as structured blocks.\n" .
"Extract the visible text ONLY (ignore logos, page decoration, headers/footers of letterhead).\n" .
"Correct obvious spelling/spacing lightly WITHOUT changing meaning; keep proper nouns; keep numbers and dates EXACTLY as written (same order and separators), only converting Indic numerals ٠-٩ to Western 0-9.\n" .
"Return ONLY JSON: {\"blocks\":[ ... ]} where each block is either\n" .
"  {\"type\":\"para\",\"role\":ROLE,\"text\":\"...\"}  with ROLE in {عنوان_رئيسي,عنوان_فرعي,نص,تعداد_ناعم,تعداد_خشن}\n" .
"  or {\"type\":\"table\",\"rows\":[[\"cell\",...],...]}  (text cells only)\n" .
"Preserve reading order. No commentary.";

    $payload = [
        'system_instruction' => ['parts' => [['text' => $sys]]],
        'contents' => [['role' => 'user', 'parts' => [
            ['inline_data' => ['mime_type' => $mime, 'data' => base64_encode($bytes)]],
            ['text' => 'استخرج المحتوى وفق التعليمات.'],
        ]]],
        'generationConfig' => ['temperature' => 0.2, 'responseMimeType' => 'application/json'],
    ];
    $txt = ga_gemini_call($payload, $key);
    $parsed = json_decode($txt, true);
    if (!is_array($parsed) || !isset($parsed['blocks'])) {
        throw new RuntimeException('ردّ الاستخراج غير صالح');
    }
    $blocks = [];
    foreach ($parsed['blocks'] as $b) {
        if (($b['type'] ?? '') === 'para') {
            $t = trim((string)($b['text'] ?? ''));
            if ($t !== '') $blocks[] = ['type' => 'para', 'role' => ga_norm_role($b['role'] ?? 'نص'), 'text' => $t];
        } elseif (($b['type'] ?? '') === 'table' && !empty($b['rows']) && is_array($b['rows'])) {
            $rows = [];
            foreach ($b['rows'] as $r) {
                if (is_array($r)) $rows[] = array_map(fn($c) => trim((string)$c), $r);
            }
            if ($rows) $blocks[] = ['type' => 'table', 'rows' => $rows];
        }
    }
    return $blocks;
}
