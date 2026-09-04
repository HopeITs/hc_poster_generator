<?php
/**
 * Guidelines Assistant — المرحلة 4: التوليد
 * -----------------------------------------------------------------
 * يبني ملفّ Word على ترويسة المحافظة: يأخذ قالب المحافظة (فيه صورة
 * الترويسة كخلفية صفحة + الهوامش) ويستبدل محتوى الجسم بالكتل المُراجَعة،
 * مع تطبيق تنسيق الأدوار مباشرةً. ثم (اختياريًّا) يحوّله PDF عبر LibreOffice.
 *
 * التوليد لا يعتمد على أي مكتبة (ZipArchive + بناء XML مباشر).
 */

declare(strict_types=1);

const GA_TWIP_CONTENT = 9638;   // عرض المحتوى في A4 بهوامش 2سم (11906 - 2*1134)

/** تنسيق كل دور: الخطّ (لاتيني/عربي)، الحجم (نصف نقطة)، اللون، المحاذاة. */
function ga_role_styles(): array
{
    return [
        'عنوان رئيسي' => ['f' => 'Somar Sans Black',    'cs' => 'Somar Sans Bold', 'sz' => 40, 'color' => 'BE1F24', 'jc' => 'center'],
        'عنوان فرعي'  => ['f' => 'Somar Sans Bold',     'cs' => 'Somar Sans Bold', 'sz' => 32, 'color' => '58595B', 'jc' => 'right'],
        'نص'          => ['f' => 'Somar Sans',          'cs' => 'Somar Sans',      'sz' => 28, 'color' => '58595B', 'jc' => 'right'],
        'تعداد ناعم'  => ['f' => 'Somar Sans',          'cs' => 'Somar Sans',      'sz' => 28, 'color' => '58595B', 'jc' => 'right'],
        'تعداد خشن'   => ['f' => 'Somar Sans SemiBold',  'cs' => 'Somar Sans SemiBold', 'sz' => 32, 'color' => '58595B', 'jc' => 'right'],
    ];
}

function ga_xml(string $s): string
{
    return str_replace(['&', '<', '>', '"'], ['&amp;', '&lt;', '&gt;', '&quot;'], $s);
}

/** خصائص التشغيل (rPr) لدور معيّن، مع تجاوزات اختيارية. */
function ga_rpr(array $st, ?int $sz = null, ?string $color = null): string
{
    $sz = $sz ?? $st['sz'];
    $color = $color ?? $st['color'];
    return '<w:rPr>'
        . '<w:rFonts w:ascii="' . ga_xml($st['f']) . '" w:hAnsi="' . ga_xml($st['f']) . '" w:cs="' . ga_xml($st['cs']) . '"/>'
        . '<w:color w:val="' . $color . '"/>'
        . '<w:sz w:val="' . $sz . '"/><w:szCs w:val="' . $sz . '"/>'
        . '<w:rtl/>'
        . '</w:rPr>';
}

/** فقرة موسومة بدور. */
function ga_para(string $role, string $text): string
{
    $styles = ga_role_styles();
    $st = $styles[$role] ?? $styles['نص'];
    $jc = $st['jc'] === 'center' ? '<w:jc w:val="center"/>' : '<w:jc w:val="right"/>';
    $ppr = '<w:pPr><w:bidi/><w:spacing w:after="120" w:line="276" w:lineRule="auto"/>' . $jc . '</w:pPr>';
    $run = '<w:r>' . ga_rpr($st) . '<w:t xml:space="preserve">' . ga_xml($text) . '</w:t></w:r>';
    return '<w:p>' . $ppr . $run . '</w:p>';
}

/** فقرة فارغة (فاصل / إغلاق بعد جدول). */
function ga_empty_para(): string
{
    return '<w:p><w:pPr><w:bidi/></w:pPr></w:p>';
}

/** خليّة جدول بنصّها (Somar Sans 10pt، توسيط). */
function ga_cell(string $text, int $colw): string
{
    $st = ['f' => 'Somar Sans', 'cs' => 'Somar Sans', 'sz' => 20, 'color' => '58595B'];
    $ppr = '<w:pPr><w:bidi/><w:spacing w:after="0" w:line="240" w:lineRule="auto"/><w:jc w:val="center"/></w:pPr>';
    $run = $text === '' ? '' : '<w:r>' . ga_rpr($st) . '<w:t xml:space="preserve">' . ga_xml($text) . '</w:t></w:r>';
    return '<w:tc><w:tcPr><w:tcW w:w="' . $colw . '" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr>'
        . '<w:p>' . $ppr . $run . '</w:p></w:tc>';
}

/** جدول بحدود البيت (0.5pt، #D3D3D5)، RTL. */
function ga_table(array $rows): string
{
    $maxCols = 0;
    foreach ($rows as $r) { $maxCols = max($maxCols, count($r)); }
    if ($maxCols === 0) return '';
    $colw = intdiv(GA_TWIP_CONTENT, $maxCols);

    $b = 'w:val="single" w:sz="4" w:space="0" w:color="D3D3D5"';
    $borders = '<w:tblBorders>'
        . "<w:top $b/><w:left $b/><w:bottom $b/><w:right $b/><w:insideH $b/><w:insideV $b/>"
        . '</w:tblBorders>';
    $grid = '<w:tblGrid>' . str_repeat('<w:gridCol w:w="' . $colw . '"/>', $maxCols) . '</w:tblGrid>';

    $trs = '';
    foreach ($rows as $r) {
        $cells = '';
        for ($i = 0; $i < $maxCols; $i++) {
            $cells .= ga_cell((string)($r[$i] ?? ''), $colw);
        }
        $trs .= '<w:tr>' . $cells . '</w:tr>';
    }

    return '<w:tbl><w:tblPr>'
        . '<w:bidiVisual/>'
        . '<w:tblW w:w="' . GA_TWIP_CONTENT . '" w:type="dxa"/>'
        . '<w:jc w:val="center"/>'
        . $borders
        . '<w:tblLook w:val="0000" w:firstRow="0" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="1" w:noVBand="1"/>'
        . '</w:tblPr>' . $grid . $trs . '</w:tbl>';
}

/** يبني محتوى الجسم من الكتل المُراجَعة. */
function ga_build_content(array $blocks): string
{
    $out = '';
    $lastWasTable = false;
    foreach ($blocks as $b) {
        $type = $b['type'] ?? 'para';
        if ($type === 'table' && !empty($b['rows'])) {
            $out .= ga_table($b['rows']);
            $lastWasTable = true;
        } else {
            $text = trim((string)($b['text'] ?? ''));
            if ($text === '') continue;
            $out .= ga_para($b['role'] ?? 'نص', $text);
            $lastWasTable = false;
        }
    }
    // الجسم يجب أن ينتهي بفقرة قبل sectPr (خاصّة بعد جدول)
    if ($out === '' || $lastWasTable) $out .= ga_empty_para();
    return $out;
}

/**
 * يبني docx على قالب المحافظة.
 * @return string مسار الملفّ الناتج (نفس $outPath).
 */
function ga_gen_docx(array $blocks, string $templatePath, string $outPath): string
{
    if (!is_file($templatePath)) throw new RuntimeException('قالب المحافظة غير موجود');

    // اقرأ document.xml من القالب
    $zip = new ZipArchive();
    if ($zip->open($templatePath) !== true) throw new RuntimeException('تعذّر فتح قالب المحافظة');
    $doc = $zip->getFromName('word/document.xml');
    $zip->close();
    if ($doc === false) throw new RuntimeException('قالب المحافظة بلا document.xml');

    // احتفظ بـ sectPr (الهوامش + مرجع الترويسة) واستبدل بقيّة الجسم
    if (!preg_match('/<w:sectPr\b[\s\S]*?<\/w:sectPr>/', $doc, $m)) {
        throw new RuntimeException('بنية القالب غير متوقّعة (لا sectPr)');
    }
    $sectPr = $m[0];

    $bodyOpen = strpos($doc, '<w:body');
    $contentStart = strpos($doc, '>', $bodyOpen);
    $bodyClose = strpos($doc, '</w:body>');
    if ($bodyOpen === false || $contentStart === false || $bodyClose === false) {
        throw new RuntimeException('بنية القالب غير متوقّعة (body)');
    }

    $newBody = ga_build_content($blocks) . $sectPr;
    $newDoc = substr($doc, 0, $contentStart + 1) . $newBody . substr($doc, $bodyClose);

    // انسخ القالب واستبدل document.xml (يبقى كل شيء آخر: الترويسة، الوسائط، الأنماط)
    if (!@copy($templatePath, $outPath)) throw new RuntimeException('تعذّر تجهيز ملفّ الإخراج');
    $zo = new ZipArchive();
    if ($zo->open($outPath) !== true) throw new RuntimeException('تعذّر الكتابة إلى ملفّ الإخراج');
    $zo->deleteName('word/document.xml');
    $zo->addFromString('word/document.xml', $newDoc);
    $zo->close();

    return $outPath;
}

/** يبحث عن soffice.exe (LibreOffice). */
function ga_soffice(): ?string
{
    $cands = [
        'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
        'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe',
        '/usr/bin/soffice', '/usr/local/bin/soffice',
    ];
    foreach ($cands as $c) { if (is_file($c)) return $c; }
    return null;
}

/**
 * يحوّل docx إلى PDF عبر LibreOffice headless.
 * @return string مسار الـPDF الناتج.
 */
function ga_gen_pdf(string $docxPath, string $outDir): string
{
    $soffice = ga_soffice();
    if ($soffice === null) throw new RuntimeException('LibreOffice غير مركّب (مطلوب لتوليد PDF)');
    if (!function_exists('exec')) throw new RuntimeException('exec غير متاح لتشغيل LibreOffice');

    $profile = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'ga_lo_profile';
    $profileUri = 'file:///' . str_replace('\\', '/', $profile);

    $cmd = escapeshellarg($soffice)
        . ' --headless --norestore -env:UserInstallation=' . escapeshellarg($profileUri)
        . ' --convert-to pdf --outdir ' . escapeshellarg($outDir)
        . ' ' . escapeshellarg($docxPath) . ' 2>&1';

    exec($cmd, $lines, $rc);
    $pdf = $outDir . DIRECTORY_SEPARATOR . pathinfo($docxPath, PATHINFO_FILENAME) . '.pdf';
    if (!is_file($pdf)) {
        throw new RuntimeException('فشل تحويل PDF: ' . implode(' | ', $lines));
    }
    return $pdf;
}
