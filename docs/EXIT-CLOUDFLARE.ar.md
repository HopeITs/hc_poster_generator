# الانفصال الكامل عن Cloudflare و Resend

بلا Laravel وبلا أطر عمل. PHP عادي على `195.42.143.64`.

---

## ما يُستبدَل بماذا

| الآن | البديل |
|---|---|
| Cloudflare Worker (16 نقطة، 379 سطر JS) | ملفات PHP على خادمنا |
| Cloudflare D1 | **SQLite** على خادمنا |
| Resend | الـMTA المحلي عبر `mail()` |
| cdnjs | ✅ انتهى — `vendor/html2canvas.min.js` |

---

## حقائق مُتحقَّق منها تُسهّل العمل

**١. كلمات السر تنتقل كما هي.** الـWorker يستخدم PBKDF2-SHA256 بـ100000 دورة،
ودالة `hash_pbkdf2` في PHP تنتج **الناتج نفسه بالضبط** — تم اختبارها مقابل
تنفيذ WebCrypto وتطابقت حرفياً:

```
PHP : 2f9a01e5ceb67f31f131556c8896f662dd26124799a14cc854daa6b6dbd613af
Node: 2f9a01e5ceb67f31f131556c8896f662dd26124799a14cc854daa6b6dbd613af
```

لا أحد يعيد تعيين كلمة سره. الدالة المطلوبة:

```php
function verifyPassword(string $password, string $stored): bool {
    [$saltHex, $hashHex] = array_pad(explode(':', $stored, 2), 2, '');
    if ($saltHex === '' || $hashHex === '') return false;
    $calc = bin2hex(hash_pbkdf2('sha256', $password, hex2bin($saltHex), 100000, 32, true));
    return hash_equals($hashHex, $calc);   // مقارنة ثابتة الزمن
}
```

**٢. D1 هي SQLite.** التصدير يخرج `CREATE TABLE ... AUTOINCREMENT` و
`datetime('now')` — أي أنه ملف SQLite صالح. الاستيراد بلا تحويل لهجة.
لثمانية مستخدمين وخمسة مشاريع، SQLite كافية تماماً وأبسط من MySQL.

**٣. نفس الأصل يُغلق ثغرة قائمة.** حين يصبح الـAPI على
`hcsyria.org/api/` بدل `workers.dev`، يصير الكوكي **من الطرف الأول**:
`HttpOnly` فلا يقرأه JavaScript. تُحَل ثغرة التوكن في `localStorage`
نهائياً، ويسقط CORS بالكامل.

---

## المرحلة ١ — البريد (تُنهي Resend)

اتبع [mailer/MIGRATION.ar.md](../mailer/MIGRATION.ar.md).
مستقلة تماماً — ابدأ بها الآن.

---

## المرحلة ٢ — بناء الـAPI بالـPHP

يُبنى تحت `hcsyria.org/api/` **دون لمس النظام العامل**.

### البنية

```
api/
├── index.php        موجّه المسارات
├── db.php           اتصال SQLite (PDO)
├── auth.php         الجلسات، PBKDF2، الصلاحيات
├── config.php       (مستثنى من Git)
└── data/app.db      قاعدة البيانات — خارج جذر المستند
```

> `data/app.db` **يجب** أن تكون خارج جذر المستند، وإلا صارت قاعدة
> البيانات كاملة قابلة للتنزيل من المتصفح.

### النقاط الست عشرة

`/health` · `/setup-owner` · `/change-owner-email` · `/login` · `/me` ·
`/logout` · `/me/photo` · `/me/photo/delete` · `/users` · `/users/add` ·
`/users/delete` · `/users/set-projects` · `/projects` · `/projects/add` ·
`/projects/update` · `/notify`

نفس الـJSON بالضبط، فالواجهة لا تشعر بالفرق.

### تغييران جوهريان عن الـWorker

**الجلسة كوكي لا توكن في الجسم:**

```php
setcookie('sz_token', $token, [
    'expires'  => time() + $days * 86400,
    'path'     => '/',
    'secure'   => true,
    'httponly' => true,     // ← الثغرة تُغلق هنا
    'samesite' => 'Strict',
]);
```

جدول `sessions` يبقى كما هو؛ يتغيّر **مكان** حمل التوكن فقط.

**`/notify` يرسل مباشرة** بـ`mail()` — لا Resend ولا حتى جسر
`mailer/send.php`، فالـAPI صار على الخادم نفسه. المرحلة ١ تصبح
مؤقتة وتُحذف هنا.

### يُنقَل كما هو

حظر محاولات الدخول (5 لكل إيميل / 20 لكل IP خلال 15 دقيقة) — نفس المنطق
ونفس جدول `login_attempts`.

---

## المرحلة ٣ — نقل البيانات

```bash
wrangler d1 export studyzone-db --remote --output d1-final.sql
sqlite3 data/app.db < d1-final.sql
```

ثم التحقق — يجب أن تطابق الأرقام:

```sql
SELECT (SELECT COUNT(*) FROM users)     AS users,      -- 8
       (SELECT COUNT(*) FROM projects)  AS projects,   -- 5
       (SELECT COUNT(*) FROM user_projects) AS links,
       (SELECT COUNT(*) FROM users WHERE photo IS NOT NULL) AS photos;  -- 3
```

**الجلسات لا تُنقَل** — الـ47 جلسة الحالية توكنات في `localStorage`
والجديدة كوكيز. الجميع يسجّل دخولاً مرة واحدة، وهذا بالضبط ما يُغلق
الثغرة.

صلاحيات الملف:

```bash
chmod 640 data/app.db && chown www-data:www-data data/app.db
```

---

## المرحلة ٤ — التحويل

في `index.html`:

```js
var WORKER = "/api";        // بدل عنوان workers.dev
```

وفي `api()`: احذف رأس `Authorization` وكل تعامل `localStorage` مع التوكن —
الكوكي يُرسَل تلقائياً في نفس الأصل.

ثم شدّ الـCSP:

```
connect-src 'self'
```

**أبقِ الـWorker يعمل 48 ساعة** كخطة رجوع قبل الحذف.

---

## المرحلة ٥ — التفكيك

بعد استقرار أسبوع:

```bash
wrangler delete --name studyzone-auth
wrangler d1 delete studyzone-db
```

وأغلق حساب Resend.

**قبل الحذف:** نسخة احتياطية من D1 في مكانين مختلفين على الأقل.

---

## ماذا تُغلق هذه الخطة من ثغرات

| الثغرة | النتيجة |
|---|---|
| التوكن في `localStorage` | ✅ **تُحَل** — كوكي `HttpOnly` من الطرف الأول |
| `Access-Control-Allow-Origin: *` | ✅ **يسقط** — لا CORS في نفس الأصل |
| `connect-src` لنطاقات خارجية | ✅ يصير `'self'` |
| CSRF | يصبح ذا معنى مع الكوكيز — `SameSite=Strict` يغطّي الأساس |
| حظر محاولات الدخول | يُنقَل كما هو |

---

## ما يجب أن تعرفه قبل أن تقرّر

**تفقد حماية Cloudflare.** الـWorker الآن خلف حافة Cloudflare: حماية DDoS
وWAF مجاناً. بعد الانتقال يصبح `195.42.143.64` نقطة فشل وحيدة للموقع
والبريد وقاعدة البيانات والمصادقة معاً.

**المسؤوليات تنتقل إليك:** تحديثات النظام، تقسية SSH، الجدار الناري،
`fail2ban`، والنسخ الاحتياطية خارج الخادم.

هذه مقايضة حقيقية مقابل الاستقلالية، وليست تفصيلاً.

---

## ما أحتاجه منك

| المرحلة | المطلوب |
|---|---|
| ١ | كما في `mailer/MIGRATION.ar.md` |
| ٢ | **أين نُشرت الواجهة بالضبط؟** لأن الـAPI يجب أن يكون على الأصل نفسه |
| ٢ | تأكيد وجود `pdo_sqlite` — `php -m \| grep sqlite` |
| ٣ | نافذة توقف قصيرة |
| ٤ | قرار التحويل |
| ٥ | تأكيد صريح قبل الحذف |

لن أطلب أي كلمة سر أو مفتاح في أي مرحلة.
