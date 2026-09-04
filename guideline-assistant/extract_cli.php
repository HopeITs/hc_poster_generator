<?php
/**
 * أداة اختبار سطر أوامر لوحدة الاستخراج (المرحلة 1).
 * الاستخدام:  php extract_cli.php "<مسار الملف>"
 */
declare(strict_types=1);
require __DIR__ . '/lib/extract.php';

if ($argc < 2) {
    fwrite(STDERR, "الاستخدام: php extract_cli.php <path-to-file>\n");
    exit(2);
}

$result = ga_extract($argv[1]);
echo json_encode($result, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES), "\n";
exit(empty($result['ok']) ? 1 : 0);
