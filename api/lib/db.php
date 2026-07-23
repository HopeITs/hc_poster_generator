<?php
/**
 * اتصال MySQL عبر PDO.
 *
 * كل الاستعلامات في هذا الـAPI تستخدم عبارات مُجهّزة (prepared statements)،
 * فلا مجال لحقن SQL.
 */

declare(strict_types=1);

function config(): array
{
    static $cfg = null;
    if ($cfg !== null) return $cfg;

    $path = __DIR__ . '/../config.php';
    if (!is_file($path)) {
        // لا نكشف المسار في رسالة الخطأ
        fail('الإعدادات غير موجودة على الخادم', 500);
    }
    return $cfg = require $path;
}

function db(): PDO
{
    static $pdo = null;
    if ($pdo instanceof PDO) return $pdo;

    $c = config()['db'];
    $dsn = sprintf('mysql:host=%s;dbname=%s;charset=%s', $c['host'], $c['name'], $c['charset'] ?? 'utf8mb4');

    try {
        $pdo = new PDO($dsn, $c['user'], $c['pass'], [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            // false: عبارات مُجهّزة حقيقية على الخادم لا محاكاة في العميل
            PDO::ATTR_EMULATE_PREPARES   => false,
        ]);
    } catch (PDOException $e) {
        // رسالة PDO تحوي اسم المستخدم والمضيف — لا تُعرض للطالب
        error_log('DB connect failed: ' . $e->getMessage());
        fail('تعذّر الاتصال بقاعدة البيانات', 500);
    }
    return $pdo;
}

/** صف واحد أو null. */
function db_one(string $sql, array $params = []): ?array
{
    $st = db()->prepare($sql);
    $st->execute($params);
    $row = $st->fetch();
    return $row === false ? null : $row;
}

/** كل الصفوف. */
function db_all(string $sql, array $params = []): array
{
    $st = db()->prepare($sql);
    $st->execute($params);
    return $st->fetchAll();
}

/** تنفيذ بلا نتيجة — يعيد عدد الصفوف المتأثرة. */
function db_run(string $sql, array $params = []): int
{
    $st = db()->prepare($sql);
    $st->execute($params);
    return $st->rowCount();
}
