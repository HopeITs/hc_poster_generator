<?php
/**
 * Guidelines Assistant — المرحلة 1: الاستخراج
 * -------------------------------------------------
 * يحوّل ملفًّا مرفوعًا إلى «نموذج مستند موحَّد»: قائمة كتل مرتّبة
 * (فقرات وجداول) بنصّها الخام — بلا تدقيق ولا تصنيف أدوار (تأتي لاحقًا).
 *
 * الأنواع المدعومة الآن: txt · md · docx.
 * الصورة و PDF الممسوح يمرّان عبر Gemini (مرحلة لاحقة، تحتاج المفتاح).
 *
 * مخطّط الكتلة:
 *   { "type":"para",  "text":"..." }
 *   { "type":"table", "rows":[ ["خليّة","خليّة"], ... ] }
 *
 * الناتج الكامل:
 *   { "ok":true, "source":"docx", "blocks":[ ... ], "stats":{...} }
 */

declare(strict_types=1);

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

/** يحوّل الأرقام العربيّة-الهنديّة والفارسيّة إلى غربيّة (قاعدة الموقع العامّة). */
function ga_westernize_digits(string $s): string
{
    $map = [
        '٠'=>'0','١'=>'1','٢'=>'2','٣'=>'3','٤'=>'4','٥'=>'5','٦'=>'6','٧'=>'7','٨'=>'8','٩'=>'9',
        '۰'=>'0','۱'=>'1','۲'=>'2','۳'=>'3','۴'=>'4','۵'=>'5','۶'=>'6','۷'=>'7','۸'=>'8','۹'=>'9',
    ];
    return strtr($s, $map);
}

/** تنظيف نصّ خليّة/فقرة: مسافات زائدة + توحيد الأرقام. */
function ga_clean(string $s): string
{
    $s = str_replace(["\r\n", "\r"], "\n", $s);
    $s = preg_replace('/[ \t\x{00A0}]+/u', ' ', $s);   // مسافات متعدّدة (تشمل NBSP)
    $s = preg_replace('/\n{3,}/', "\n\n", $s);
    return trim(ga_westernize_digits($s));
}

/* ============================ txt / md ============================ */

function ga_extract_text(string $path): array
{
    $raw = file_get_contents($path);
    if ($raw === false) {
        return ['ok' => false, 'error' => 'تعذّرت قراءة الملف'];
    }
    // إزالة BOM إن وُجد
    $raw = preg_replace('/^\xEF\xBB\xBF/', '', $raw);
    $raw = str_replace(["\r\n", "\r"], "\n", $raw);

    // فقرات = مفصولة بسطر فارغ؛ الأسطر داخل الفقرة تُدمَج بمسافة.
    $chunks = preg_split('/\n[ \t]*\n/', $raw);
    $blocks = [];
    foreach ($chunks as $chunk) {
        $text = ga_clean(str_replace("\n", ' ', $chunk));
        if ($text !== '') {
            $blocks[] = ['type' => 'para', 'text' => $text];
        }
    }
    return ['ok' => true, 'source' => 'text', 'blocks' => $blocks];
}

/* ============================== docx ============================== */

/** نصّ عنصر (فقرة/خليّة) = دمج كل عُقد w:t بداخله بالترتيب. */
function ga_node_text(DOMNode $node, DOMXPath $xp): string
{
    $parts = [];
    foreach ($xp->query('.//w:t', $node) as $t) {
        $parts[] = $t->textContent;
    }
    // w:tab و w:br تُعامَل كمسافات لطيفة
    return implode('', $parts);
}

function ga_extract_docx(string $path): array
{
    if (!class_exists('ZipArchive')) {
        return ['ok' => false, 'error' => 'إضافة zip غير مفعّلة في PHP'];
    }
    $zip = new ZipArchive();
    if ($zip->open($path) !== true) {
        return ['ok' => false, 'error' => 'الملف ليس docx صالحًا'];
    }
    $xml = $zip->getFromName('word/document.xml');
    $zip->close();
    if ($xml === false) {
        return ['ok' => false, 'error' => 'لا يحتوي الملف على word/document.xml'];
    }

    $dom = new DOMDocument();
    // كتم تحذيرات XML المشوّه؛ نتحقّق من النتيجة يدويًّا
    if (!@$dom->loadXML($xml, LIBXML_NOENT | LIBXML_NONET)) {
        return ['ok' => false, 'error' => 'تعذّر تحليل XML للمستند'];
    }
    $xp = new DOMXPath($dom);
    $xp->registerNamespace('w', W_NS);

    $bodies = $xp->query('/w:document/w:body');
    if ($bodies->length === 0) {
        return ['ok' => false, 'error' => 'بنية المستند غير متوقّعة (لا body)'];
    }
    $body = $bodies->item(0);

    $blocks = [];
    // أبناء body مباشرة، بالترتيب: w:p (فقرة) و w:tbl (جدول)
    foreach ($body->childNodes as $child) {
        if ($child->nodeType !== XML_ELEMENT_NODE || $child->namespaceURI !== W_NS) {
            continue;
        }
        if ($child->localName === 'p') {
            $text = ga_clean(ga_node_text($child, $xp));
            if ($text !== '') {
                $blocks[] = ['type' => 'para', 'text' => $text];
            }
        } elseif ($child->localName === 'tbl') {
            $rows = [];
            // صفوف مباشرة فقط (تفادي صفوف الجداول المتداخلة)
            foreach ($xp->query('./w:tr', $child) as $tr) {
                $cells = [];
                foreach ($xp->query('./w:tc', $tr) as $tc) {
                    $cells[] = ga_clean(ga_node_text($tc, $xp));
                }
                if ($cells) {
                    $rows[] = $cells;
                }
            }
            if ($rows) {
                $blocks[] = ['type' => 'table', 'rows' => $rows];
            }
        }
    }

    return ['ok' => true, 'source' => 'docx', 'blocks' => $blocks];
}

/* ============================ dispatcher ============================ */

function ga_extract(string $path): array
{
    if (!is_file($path)) {
        return ['ok' => false, 'error' => 'الملف غير موجود: ' . $path];
    }
    $ext = strtolower(pathinfo($path, PATHINFO_EXTENSION));
    $result = match ($ext) {
        'txt', 'md', 'markdown' => ga_extract_text($path),
        'docx'                  => ga_extract_docx($path),
        'png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'tif', 'tiff'
            => ['ok' => false, 'error' => 'استخراج الصور يحتاج مفتاح Gemini (مرحلة لاحقة)', 'source' => 'image'],
        'pdf'
            => ['ok' => false, 'error' => 'استخراج PDF يحتاج مفتاح Gemini (مرحلة لاحقة)', 'source' => 'pdf'],
        default => ['ok' => false, 'error' => "امتداد غير مدعوم: .$ext"],
    };

    if (!empty($result['ok'])) {
        $paras = 0; $tables = 0; $cells = 0;
        foreach ($result['blocks'] as $b) {
            if ($b['type'] === 'para') { $paras++; }
            elseif ($b['type'] === 'table') { $tables++; foreach ($b['rows'] as $r) { $cells += count($r); } }
        }
        $result['stats'] = ['blocks' => count($result['blocks']), 'paragraphs' => $paras, 'tables' => $tables, 'cells' => $cells];
    }
    return $result;
}
