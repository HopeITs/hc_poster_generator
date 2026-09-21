<?php
/**
 * POST /guideline-assistant/api/process.php   (multipart: file=<الملف>)
 * يقرأ الملفّ ← يستخرج ← يدقّق ويصنّف ← يعيد كتلًا موسومة بالأدوار.
 * الردّ: { ok, source, blocks:[ {type:'para',role,text} | {type:'table',rows} ], stats }
 */

declare(strict_types=1);
header('Content-Type: application/json; charset=utf-8');

require __DIR__ . '/../lib/extract.php';
require __DIR__ . '/../lib/process.php';

function ga_fail(string $msg, int $code = 400): never
{
    http_response_code($code);
    echo json_encode(['ok' => false, 'error' => $msg], JSON_UNESCAPED_UNICODE);
    exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    ga_fail('الطريقة غير مسموحة', 405);
}
if (!ga_ai_ready()) {
    ga_fail('خدمة المعالجة غير مضبوطة على الخادم (GA_SHARED_SECRET)', 500);
}
if (empty($_FILES['file']) || ($_FILES['file']['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
    ga_fail('لم يصل أي ملفّ صالح');
}

$origName = (string)$_FILES['file']['name'];
$ext = strtolower(pathinfo($origName, PATHINFO_EXTENSION));
$tmpIn = (string)$_FILES['file']['tmp_name'];

// انسخ إلى مسار مؤقّت يحمل الامتداد الصحيح (المُستخرِج يعتمد على الامتداد)
$work = tempnam(sys_get_temp_dir(), 'ga_') . '.' . $ext;
if (!@copy($tmpIn, $work)) {
    ga_fail('تعذّر تجهيز الملفّ للمعالجة', 500);
}

$visionMime = [
    'png' => 'image/png', 'jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg', 'webp' => 'image/webp',
    'gif' => 'image/gif', 'bmp' => 'image/bmp', 'tif' => 'image/tiff', 'tiff' => 'image/tiff',
    'pdf' => 'application/pdf',
];

try {
    if (isset($visionMime[$ext])) {
        /* صورة أو PDF: استخراج + تصحيح + تصنيف بنداء واحد */
        $blocks = ga_vision_extract($work, $visionMime[$ext]);
        $source = $ext === 'pdf' ? 'pdf' : 'image';
    } else {
        /* نصّ أو docx: استخراج محليّ ثم تدقيق + تصنيف */
        $ex = ga_extract($work);
        if (empty($ex['ok'])) ga_fail($ex['error'] ?? 'تعذّر الاستخراج', 422);

        $paras = [];
        foreach ($ex['blocks'] as $i => $b) {
            if ($b['type'] === 'para') $paras[] = ['i' => $i, 'text' => $b['text']];
        }
        $map = ga_process_paragraphs($paras);

        $blocks = [];
        foreach ($ex['blocks'] as $i => $b) {
            if ($b['type'] === 'para') {
                $blocks[] = [
                    'type' => 'para',
                    'role' => $map[$i]['role'] ?? 'نص',
                    'text' => $map[$i]['text'] ?? $b['text'],
                ];
            } elseif ($b['type'] === 'table') {
                $blocks[] = ['type' => 'table', 'rows' => $b['rows']];
            }
        }
        $source = $ex['source'];
    }
} catch (Throwable $e) {
    @unlink($work);
    ga_fail($e->getMessage(), 502);
}
@unlink($work);

$paraN = 0; $tableN = 0;
foreach ($blocks as $b) { $b['type'] === 'table' ? $tableN++ : $paraN++; }

echo json_encode([
    'ok' => true,
    'source' => $source,
    'blocks' => $blocks,
    'stats' => ['blocks' => count($blocks), 'paragraphs' => $paraN, 'tables' => $tableN],
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
