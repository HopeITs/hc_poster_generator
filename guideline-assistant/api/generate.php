<?php
/**
 * POST /guideline-assistant/api/generate.php   (JSON)
 * body: { blocks:[...], govs:["HMS","ALP"|"all"], formats:["docx","pdf"] }
 * يبني لكل محافظة مستندًا على ترويستها (Word و/أو PDF). ملفّ واحد يُعاد مباشرةً،
 * وعدّة ملفّات تُجمَّع في ZIP.
 */

declare(strict_types=1);
require __DIR__ . '/../lib/generate.php';

function gg_fail(string $msg, int $code = 400): never
{
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['ok' => false, 'error' => $msg], JSON_UNESCAPED_UNICODE);
    exit;
}

const GG_GOVS = [
    'DMS' => 'دمشق', 'HMS' => 'حمص', 'LAT' => 'اللاذقية', 'ALP' => 'حلب',
];

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') gg_fail('الطريقة غير مسموحة', 405);

$in = json_decode((string)file_get_contents('php://input'), true);
if (!is_array($in)) gg_fail('طلب غير صالح');

$blocks = $in['blocks'] ?? null;
if (!is_array($blocks) || !$blocks) gg_fail('لا يوجد محتوى للتوليد');

// المحافظات
$govs = $in['govs'] ?? [];
if (in_array('all', (array)$govs, true)) $govs = array_keys(GG_GOVS);
$govs = array_values(array_intersect((array)$govs, array_keys(GG_GOVS)));
if (!$govs) gg_fail('اختر محافظة واحدة على الأقل');

// الصيغ
$formats = array_values(array_intersect((array)($in['formats'] ?? []), ['docx', 'pdf']));
if (!$formats) gg_fail('اختر صيغة إخراج واحدة على الأقل');
if (in_array('pdf', $formats, true) && ga_soffice() === null) {
    gg_fail('توليد PDF يحتاج LibreOffice غير المركّب على الخادم', 503);
}

// عنوان المستند من أول كتلة «عنوان رئيسي» (لاسم الملفّ)
$title = 'مستند';
foreach ($blocks as $b) {
    if (($b['type'] ?? '') !== 'table' && ($b['role'] ?? '') === 'عنوان رئيسي' && trim((string)($b['text'] ?? '')) !== '') {
        $title = trim((string)$b['text']);
        break;
    }
}
$title = preg_replace('/[\/\\\\:\*\?"<>\|\x00-\x1F]/u', '', $title);
$title = mb_substr(trim($title), 0, 60);
if ($title === '') $title = 'مستند';

$tmplDir = __DIR__ . '/../templates';
$work = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'ga_out_' . bin2hex(random_bytes(4));
@mkdir($work, 0700, true);

$files = [];   // [ اسم-العرض => المسار ]
try {
    foreach ($govs as $g) {
        $tmpl = $tmplDir . DIRECTORY_SEPARATOR . $g . '.docx';
        if (!is_file($tmpl)) gg_fail("قالب المحافظة غير موجود: $g", 500);

        $base = '001HC_' . $g . '_' . $title;
        $docxPath = $work . DIRECTORY_SEPARATOR . $base . '.docx';
        ga_gen_docx($blocks, $tmpl, $docxPath);
        // ملاحظة: تضمين الخطوط (ga_embed_fonts) مُعطَّل — كان يكسر بنية الملفّ
        // فيصلّحه Word ويفقد اتجاه RTL. الـPDF يضمّن الخطوط تلقائيًّا للحمل.

        if (in_array('docx', $formats, true)) $files[$base . '.docx'] = $docxPath;
        if (in_array('pdf', $formats, true)) {
            $pdf = ga_gen_pdf($docxPath, $work);
            $files[$base . '.pdf'] = $pdf;
        }
    }
} catch (Throwable $e) {
    gg_fail($e->getMessage(), 502);
}

if (!$files) gg_fail('لم يُنتَج أي ملفّ', 500);

/* ملفّ واحد → إعادة مباشرة؛ أكثر → ZIP */
if (count($files) === 1) {
    $name = array_key_first($files);
    $path = $files[$name];
    $ct = str_ends_with($name, '.pdf')
        ? 'application/pdf'
        : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    header('Content-Type: ' . $ct);
    header("Content-Disposition: attachment; filename*=UTF-8''" . rawurlencode($name));
    header('Content-Length: ' . filesize($path));
    readfile($path);
} else {
    $zipPath = $work . DIRECTORY_SEPARATOR . 'guidelines.zip';
    $zip = new ZipArchive();
    $zip->open($zipPath, ZipArchive::CREATE | ZipArchive::OVERWRITE);
    foreach ($files as $name => $path) $zip->addFile($path, $name);
    $zip->close();
    header('Content-Type: application/zip');
    header("Content-Disposition: attachment; filename*=UTF-8''" . rawurlencode('Guidelines_' . $title . '.zip'));
    header('Content-Length: ' . filesize($zipPath));
    readfile($zipPath);
}

/* تنظيف */
foreach (glob($work . DIRECTORY_SEPARATOR . '*') as $f) @unlink($f);
@rmdir($work);
