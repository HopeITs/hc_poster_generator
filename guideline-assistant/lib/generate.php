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
        'عنوان فرعي'  => ['f' => 'Somar Sans Bold',     'cs' => 'Somar Sans Bold', 'sz' => 32, 'color' => '58595B', 'jc' => 'center'],
        'نص'          => ['f' => 'Somar Sans',          'cs' => 'Somar Sans',      'sz' => 28, 'color' => '58595B', 'jc' => 'right'],
        'تعداد ناعم'  => ['f' => 'Somar Sans',          'cs' => 'Somar Sans',      'sz' => 28, 'color' => '58595B', 'jc' => 'right'],
        'تعداد خشن'   => ['f' => 'Somar Sans SemiBold',  'cs' => 'Somar Sans SemiBold', 'sz' => 32, 'color' => '58595B', 'jc' => 'right'],
    ];
}

function ga_xml(string $s): string
{
    return str_replace(['&', '<', '>', '"'], ['&amp;', '&lt;', '&gt;', '&quot;'], $s);
}

/**
 * يثبّت التسلسلات الرقميّة (تواريخ/أوقات مثل 2026/9/20) كوحدة LTR بإحاطتها
 * بعلامة LRM، فلا ينعكس ترتيب مقاطعها داخل السطر العربيّ (RTL).
 */
function ga_ltr_numbers(string $s): string
{
    $LRM = "\u{200E}";
    return preg_replace('/([0-9]+(?:[\/.:\-][0-9]+)+)/u', $LRM . '$1' . $LRM, $s);
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
        . '<w:rtl/><w:cs/>'
        . '</w:rPr>';
}

/** فقرة موسومة بدور. */
function ga_para(string $role, string $text): string
{
    $styles = ga_role_styles();
    $st = $styles[$role] ?? $styles['نص'];
    $jc = $st['jc'] === 'center' ? '<w:jc w:val="center"/>' : '<w:jc w:val="right"/>';
    // <w:bidi/> = فقرة RTL ؛ <w:rPr><w:rtl/> = علامة الفقرة RTL (يلزم Word)
    $ppr = '<w:pPr><w:bidi/><w:spacing w:after="120" w:line="276" w:lineRule="auto"/>' . $jc . '<w:rPr><w:rtl/></w:rPr></w:pPr>';
    $run = '<w:r>' . ga_rpr($st) . '<w:t xml:space="preserve">' . ga_xml(ga_ltr_numbers($text)) . '</w:t></w:r>';
    return '<w:p>' . $ppr . $run . '</w:p>';
}

/** فقرة فارغة (فاصل / إغلاق بعد جدول). */
function ga_empty_para(): string
{
    return '<w:p><w:pPr><w:bidi/><w:rPr><w:rtl/></w:rPr></w:pPr></w:p>';
}

/** خليّة جدول. $o: fill (تعبئة)، font، color، bold. */
function ga_cell(string $text, int $colw, array $o): string
{
    $shd = !empty($o['fill']) ? '<w:shd w:val="clear" w:color="auto" w:fill="' . $o['fill'] . '"/>' : '';
    $ppr = '<w:pPr><w:bidi/><w:spacing w:after="0" w:line="240" w:lineRule="auto"/><w:jc w:val="center"/><w:rPr><w:rtl/></w:rPr></w:pPr>';
    $b = !empty($o['bold']) ? '<w:b/><w:bCs/>' : '';
    $rpr = '<w:rPr><w:rFonts w:ascii="' . ga_xml($o['font']) . '" w:hAnsi="' . ga_xml($o['font']) . '" w:cs="' . ga_xml($o['font']) . '"/>'
        . $b . '<w:color w:val="' . $o['color'] . '"/><w:sz w:val="20"/><w:szCs w:val="20"/><w:rtl/><w:cs/></w:rPr>';
    $run = $text === '' ? '' : '<w:r>' . $rpr . '<w:t xml:space="preserve">' . ga_xml(ga_ltr_numbers($text)) . '</w:t></w:r>';
    return '<w:tc><w:tcPr><w:tcW w:w="' . $colw . '" w:type="dxa"/>' . $shd . '<w:vAlign w:val="center"/></w:tcPr>'
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

    // الصفّ الأول = رأس أحمر بنصّ أبيض؛ بقيّة الصفوف زِبرا (أبيض / #F4F4F5)
    $trs = '';
    foreach ($rows as $ri => $r) {
        $cells = '';
        for ($i = 0; $i < $maxCols; $i++) {
            if ($ri === 0) {
                $o = ['fill' => 'BE1F24', 'font' => 'Somar Sans SemiBold', 'color' => 'FFFFFF', 'bold' => true];
            } else {
                $o = ['fill' => ($ri % 2 === 0) ? 'F4F4F5' : '', 'font' => 'Somar Sans Medium', 'color' => '6F6E71', 'bold' => false];
            }
            $cells .= ga_cell((string)($r[$i] ?? ''), $colw, $o);
        }
        $trHead = $ri === 0 ? '<w:trPr><w:tblHeader/></w:trPr>' : '';
        $trs .= '<w:tr>' . $trHead . $cells . '</w:tr>';
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
    $out = ga_empty_para();   // سطر فاصل تحت الهيدر
    foreach ($blocks as $b) {
        $type = $b['type'] ?? 'para';
        if ($type === 'table' && !empty($b['rows'])) {
            $out .= ga_table($b['rows']);
        } else {
            $text = trim((string)($b['text'] ?? ''));
            if ($text === '') continue;
            $out .= ga_para($b['role'] ?? 'نص', $text);
        }
    }
    $out .= ga_empty_para();   // سطر فاصل فوق الفووتر (ويضمن انتهاء الجسم بفقرة)
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
    // اجعل السيكشن نفسه RTL (يمنع Word من فرض LTR على الفقرات)
    if (strpos($sectPr, '<w:bidi/>') === false) {
        if (strpos($sectPr, '<w:docGrid') !== false) {
            $sectPr = str_replace('<w:docGrid', '<w:bidi/><w:docGrid', $sectPr);
        } else {
            $sectPr = str_replace('</w:sectPr>', '<w:bidi/></w:sectPr>', $sectPr);
        }
    }

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

/* ============================ تضمين الخطوط ============================ */

/** الخطوط المضمَّنة: اسم العائلة => ملفّ OTF. */
function ga_embed_map(): array
{
    $d = __DIR__ . '/../fonts/';
    return [
        'Somar Sans'          => $d . 'SomarSans-Regular.otf',
        'Somar Sans Medium'   => $d . 'SomarSans-Medium.otf',
        'Somar Sans SemiBold' => $d . 'SomarSans-SemiBold.otf',
        'Somar Sans Bold'     => $d . 'SomarSans-Bold.otf',
        'Somar Sans Black'    => $d . 'SomarSans-Black.otf',
    ];
}

/**
 * يشوّش أول 32 بايت وفق ECMA-376 (نفس ترتيب بايتات GUID عند Word:
 * Guid.ToByteArray). يُعيد [البيانات المشوّشة، نصّ الـGUID للـfontKey].
 */
function ga_obfuscate_font(string $font): array
{
    $R = array_values(unpack('C16', random_bytes(16)));  // 16 بايت (= ToByteArray)
    // نصّ الـGUID الذي يعيد Word تحليله إلى نفس $R (عكس أول 3 مجموعات)
    $guid = sprintf(
        '{%02X%02X%02X%02X-%02X%02X-%02X%02X-%02X%02X-%02X%02X%02X%02X%02X%02X}',
        $R[3], $R[2], $R[1], $R[0], $R[5], $R[4], $R[7], $R[6],
        $R[8], $R[9], $R[10], $R[11], $R[12], $R[13], $R[14], $R[15]
    );
    $n = min(32, strlen($font));
    for ($i = 0; $i < $n; $i++) {
        $font[$i] = chr(ord($font[$i]) ^ $R[15 - ($i % 16)]);
    }
    return [$font, $guid];
}

/** يضمّن خطوط Somar داخل docx موجود (يعدّله في مكانه). */
function ga_embed_fonts(string $docxPath): void
{
    $zip = new ZipArchive();
    if ($zip->open($docxPath) !== true) return;

    $fontTable = $zip->getFromName('word/fontTable.xml');
    $ctypes    = $zip->getFromName('[Content_Types].xml');
    $settings  = $zip->getFromName('word/settings.xml');
    if ($fontTable === false || $ctypes === false || $settings === false) { $zip->close(); return; }

    $fontsXml = '';
    $rels = '';
    $i = 0;
    foreach (ga_embed_map() as $family => $otf) {
        if (!is_file($otf)) continue;
        $i++;
        [$obf, $guid] = ga_obfuscate_font(file_get_contents($otf));
        $zip->addFromString("word/fonts/font$i.odttf", $obf);
        $rid = "gaFont$i";
        $rels .= '<Relationship Id="' . $rid . '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/font" Target="fonts/font' . $i . '.odttf"/>';
        $fontsXml .= '<w:font w:name="' . ga_xml($family) . '"><w:embedRegular r:id="' . $rid . '" w:fontKey="' . $guid . '"/></w:font>';
    }
    if ($i === 0) { $zip->close(); return; }

    // 1) fontTable.xml — أضف عائلات الخطوط المضمَّنة
    $fontTable = str_replace('</w:fonts>', $fontsXml . '</w:fonts>', $fontTable);
    $zip->deleteName('word/fontTable.xml');
    $zip->addFromString('word/fontTable.xml', $fontTable);

    // 2) علاقات fontTable
    $relsXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        . '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' . $rels . '</Relationships>';
    $zip->deleteName('word/_rels/fontTable.xml.rels');
    $zip->addFromString('word/_rels/fontTable.xml.rels', $relsXml);

    // 3) [Content_Types] — نوع odttf
    if (strpos($ctypes, 'Extension="odttf"') === false) {
        $ctypes = str_replace('</Types>',
            '<Default Extension="odttf" ContentType="application/vnd.openxmlformats-officedocument.obfuscatedFont"/></Types>',
            $ctypes);
        $zip->deleteName('[Content_Types].xml');
        $zip->addFromString('[Content_Types].xml', $ctypes);
    }

    // 4) settings.xml — فعّل التضمين
    if (strpos($settings, '<w:embedTrueTypeFonts/>') === false) {
        $settings = preg_replace('/(<w:settings\b[^>]*>)/', '$1<w:embedTrueTypeFonts/><w:embedSystemFonts/>', $settings, 1);
        $zip->deleteName('word/settings.xml');
        $zip->addFromString('word/settings.xml', $settings);
    }

    $zip->close();
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
