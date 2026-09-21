<?php
/**
 * Guidelines Assistant — المرحلة 2: المعالجة (تدقيق + تصنيف الأدوار)
 * -----------------------------------------------------------------
 * نداءات Gemini تمرّ عبر Cloudflare Worker (studyzone-auth)، لأنّ Gemini
 * محظور جغرافيًّا على الخوادم في سوريا؛ الـWorker على شبكة Cloudflare
 * يتجاوز الحظر. المصادقة خادم-لخادم بسرّ مشترك GA_SHARED_SECRET
 * (يُقرأ من config.php المحليّ أو من متغيّر بيئة). مفتاح Gemini نفسه
 * مخزَّن سرًّا داخل الـWorker فقط.
 *
 * - ga_process_paragraphs(): للنصّ/الـdocx (بعد الاستخراج المحليّ).
 * - ga_vision_extract():     للصورة/الـPDF (استخراج + تصحيح + تصنيف بنداء واحد).
 */

declare(strict_types=1);

/** الأدوار القانونيّة (مطابقة لأنماط Template.docx). */
const GA_ROLES = ['عنوان رئيسي', 'عنوان فرعي', 'نص', 'تعداد ناعم', 'تعداد خشن'];

/** عنوان الـWorker الافتراضيّ (يمكن تجاوزه من config.php أو البيئة). */
const GA_WORKER_DEFAULT = 'https://studyzone-auth.ct-aleppo3.workers.dev';

/** إعدادات محليّة من config.php (مع تخزين مؤقّت). */
function ga_cfg(): array
{
    static $c = null;
    if ($c !== null) return $c;
    $c = [];
    $f = __DIR__ . '/../config.php';
    if (is_file($f)) { $v = include $f; if (is_array($v)) $c = $v; }
    return $c;
}

function ga_worker_url(): string
{
    $u = (string)(getenv('GA_WORKER_URL') ?: (ga_cfg()['WORKER_URL'] ?? GA_WORKER_DEFAULT));
    return rtrim($u, '/');
}

function ga_worker_secret(): string
{
    return (string)(getenv('GA_SHARED_SECRET') ?: (ga_cfg()['GA_SHARED_SECRET'] ?? ''));
}

/** جاهزيّة خدمة المعالجة: السرّ المشترك مضبوط. */
function ga_ai_ready(): bool
{
    return ga_worker_secret() !== '';
}

/** يوحّد اسم الدور القادم من النموذج إلى أحد الأدوار القانونيّة. */
function ga_norm_role($r): string
{
    $r = str_replace('_', ' ', trim((string)$r));
    return in_array($r, GA_ROLES, true) ? $r : 'نص';
}

/** نداء الـWorker: POST JSON مع السرّ المشترك. يُعيد المصفوفة أو يرمي استثناءً. */
function ga_worker_post(string $path, array $payload): array
{
    $sec = ga_worker_secret();
    if ($sec === '') {
        throw new RuntimeException('سرّ المعالجة غير مضبوط على الخادم (GA_SHARED_SECRET)');
    }
    $ch = curl_init(ga_worker_url() . $path);
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => ['Content-Type: application/json; charset=utf-8', 'x-ga-secret: ' . $sec],
        CURLOPT_POSTFIELDS => json_encode($payload, JSON_UNESCAPED_UNICODE),
        CURLOPT_TIMEOUT => 120,
    ]);
    $body = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $cerr = curl_error($ch);
    curl_close($ch);

    if ($body === false) {
        throw new RuntimeException('تعذّر الاتصال بخدمة المعالجة: ' . $cerr);
    }
    $d = json_decode($body, true);
    if ($code !== 200 || !is_array($d)) {
        $msg = (is_array($d) && !empty($d['error'])) ? $d['error'] : ('HTTP ' . $code);
        throw new RuntimeException('فشل المعالجة: ' . $msg);
    }
    return $d;
}

/**
 * يدقّق ويصنّف فقرات نصّية عبر الـWorker.
 * $paras: [ ['i'=>int, 'text'=>string], ... ]
 * يُعيد خريطة i => ['role'=>..., 'text'=>...]
 */
function ga_process_paragraphs(array $paras): array
{
    if (!$paras) return [];
    $items = array_map(fn($p) => ['i' => $p['i'], 'text' => $p['text']], $paras);
    $d = ga_worker_post('/ga/process', ['items' => $items]);
    if (!isset($d['items']) || !is_array($d['items'])) {
        throw new RuntimeException('ردّ التصنيف غير صالح');
    }
    $out = [];
    foreach ($d['items'] as $it) {
        if (!isset($it['i'])) continue;
        $out[(int)$it['i']] = [
            'role' => ga_norm_role($it['role'] ?? 'نص'),
            'text' => (string)($it['text'] ?? ''),
        ];
    }
    return $out;
}

/**
 * استخراج + تصحيح + تصنيف من صورة أو PDF عبر الـWorker (نداء متعدّد الوسائط).
 * يُعيد قائمة كتل: [ ['type'=>'para','role'=>..,'text'=>..] , ['type'=>'table','rows'=>[[..]]] ]
 */
function ga_vision_extract(string $path, string $mime): array
{
    $bytes = file_get_contents($path);
    if ($bytes === false) throw new RuntimeException('تعذّرت قراءة الملف');

    $d = ga_worker_post('/ga/vision', ['mime' => $mime, 'data' => base64_encode($bytes)]);
    if (!isset($d['blocks']) || !is_array($d['blocks'])) {
        throw new RuntimeException('ردّ الاستخراج غير صالح');
    }
    $blocks = [];
    foreach ($d['blocks'] as $b) {
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
