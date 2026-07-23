# دليل التنفيذ — نقل قاعدة البيانات وتحويل البريد

خطوات مُرتّبة، كلٌّ منها بمعيار نجاح صريح. لا تتقدّم خطوة قبل أن يتحقّق معيارها.

الوضع المُتحقَّق منه محلياً قبل البدء:

- `mail.s1893.sureserver.com:465` يعمل: TLS 1.3، الشهادة صالحة، و`AUTH LOGIN`
  يقبل بيانات `no-reply@hcsyria.org`.
- المنفذ 587 لم يستجب من شبكة التطوير، فالإعداد يستعمل 465.
- النطاق يشير إلى `195.42.143.64` — الخادم نفسه المذكور في
  [EXIT-CLOUDFLARE.ar.md](EXIT-CLOUDFLARE.ar.md)، أي أن الموقع والبريد على
  الجهاز ذاته.
- سلسلة النقل كاملة مُختبَرة على MariaDB محلية: التحويل ثم الاستيراد ثم قراءة
  الـAPI للبيانات — بما فيها كلمات السر والعربية و`brand_json`.

---

## ١ — نسخة احتياطية من D1

```bash
wrangler d1 export studyzone-db --remote --output d1-final.sql
```

> **المعيار:** حجم الملف > 0، وفيه أسطر `INSERT INTO`. احفظ نسختين في مكانين
> مختلفين (لا كلتاهما على الجهاز نفسه). لا تتقدّم قبل ذلك.

سجّل الأعداد الأصلية للمقارنة لاحقاً:

```bash
wrangler d1 execute studyzone-db --remote --command \
  "SELECT (SELECT COUNT(*) FROM users) users, (SELECT COUNT(*) FROM projects) projects, (SELECT COUNT(*) FROM user_projects) links"
```

---

## ٢ — التحويل إلى MySQL

```bash
python tools/d1-to-mysql.py d1-final.sql > data.sql
```

الأداة تطبع ملخّصاً على stderr مثل `-- kept users 8 row(s) (7 columns named)`.

> **المعيار:** الأعداد تطابق الخطوة ١. الأداة تتوقّف بالرمز 2 إن لم تجد أي
> `INSERT` بدل أن تكتب ملفاً فارغاً، فنجاحها يعني أن هناك بيانات فعلاً.
>
> **تحذير يستحق التوقّف:** أي سطر `-- WARNING ... inserted positionally` يعني
> أن الأداة لم تجد `CREATE TABLE` لذلك الجدول فأدرجت صفوفه بالترتيب. راجع
> ترتيب الأعمدة يدوياً مقابل [mysql-schema.sql](mysql-schema.sql) قبل الاستيراد.

`sessions` و`login_attempts` لا تُنقلان عمداً: الأولى توكنات يستبدلها الكوكي،
والثانية بيانات حظر مؤقتة يحذفها التطبيق بنفسه.

---

## ٣ — إنشاء القاعدة والاستيراد

من لوحة الاستضافة: أنشئ قاعدة ومستخدماً، والترميز **utf8mb4** —
`utf8` القديم ثلاثي البايت يفسد العربية.

```bash
mysql -u USER -p DBNAME < docs/mysql-schema.sql
mysql -u USER -p DBNAME < data.sql
```

> **المعيار:** لا رسالة `ERROR`. الخطأ الشائع `Column count doesn't match`
> يعني اختلاف المخطّط عن التصدير — توقّف وراجع، لا تُجبر الاستيراد.

---

## ٤ — التحقّق من البيانات

```bash
mysql -u USER -p --default-character-set=utf8mb4 -t DBNAME < docs/verify-migration.sql
```

> **المعيار — كل هذه معاً:**
>
> | الفحص | المتوقّع |
> |---|---|
> | `counts` | يطابق الخطوة ١ |
> | `arabic survived` | أسماء عربية مقروءة لا `?` ولا مربّعات |
> | `bad_password_rows` | **0** — أي رقم آخر يعني كلمات سر لن تعمل |
> | `brand_json valid` | `1` لكل مشروع |
> | `orphan_users` / `orphan_links` | **0** |
> | `hekmat_rows` | 1 |

`bad_password_rows` أهمّها: صيغة PBKDF2 هي `saltHex(32):hashHex(64)` = 97
محرفاً. أي انحراف يعني أن المستخدم لن يستطيع الدخول بكلمته الحالية.

---

## ٥ — إعدادات الخادم

انسخ [api/config.example.php](../api/config.example.php) إلى `api/config.php`
على الخادم واملأ:

| المفتاح | القيمة |
|---|---|
| `db.host` / `db.name` / `db.user` / `db.pass` | من لوحة الاستضافة |
| `setup_secret` | `openssl rand -hex 32` — قيمة جديدة، لا القديمة |
| `smtp.pass` | كلمة سر صندوق `no-reply@hcsyria.org` |
| `notify_to` | `['hekmat.jouby@hcsyria.org']` |
| `cookie_secure` | `true` |

`api/config.php` مستثنى من Git ومحجوب في [api/.htaccess](../api/.htaccess).
لا تضعه في المستودع بأي حال.

> **المعيار:** `GET https://<النطاق>/api/health` يرد
> `{"ok":true,"service":"postgen-api","db":"up"}`.
> `"db":"down"` أو خطأ 500 = بيانات القاعدة خاطئة. توقّف هنا.

### إن رفض البريد الخروج

سجل الأخطاء يحمل سبب الرفض حرفياً من الخادم (`smtp: ...`). العلاج بالترتيب:

1. `smtp.port = 587` و`smtp.secure = 'tls'`.
2. `smtp.host = 'localhost'` — الموقع والبريد على الجهاز نفسه.
3. احذف مفتاح `smtp` كله ليعود التطبيق إلى `mail()` المحلية.

---

## ٦ — التحويل والتحقّق النهائي

| # | الخطوة | المعيار |
|---|---|---|
| 1 | ارفع `api/` و`index.html` و`.htaccess` | — |
| 2 | `/api/health` | `"db":"up"` |
| 3 | تسجيل دخول بحساب حقيقي | الجلسة تثبت بعد تحديث الصفحة |
| 4 | إرسال بوستر تجريبي | يصل إلى `hekmat.jouby@hcsyria.org` بالمرفقات |
| 5 | الرد على الإشعار | يذهب إلى مُرسِل الطلب لا إلى `no-reply` |

**أبقِ الـWorker يعمل ٤٨ ساعة** بعد التحويل كخطة رجوع.

### إن رُفض البوستر بحجمه

المرفقات تُرسَل base64 في طلب واحد. خادم البريد لا يعلن حداً للحجم
(`SIZE 0`)، فالحدّ الفعلي في PHP: `post_max_size` و`upload_max_filesize`
و`memory_limit`. ارفعها من اللوحة إن ظهر خطأ 413 أو رد فارغ.

---

## ٧ — التفكيك (بعد أسبوع من الاستقرار)

```bash
wrangler delete --name studyzone-auth
wrangler d1 delete studyzone-db
```

ثم إغلاق حساب Resend، وحذف مجلد `worker/` من المستودع.

> **قبل التنفيذ:** تأكّد أن نسخة الخطوة ١ ما تزال موجودة وقابلة للقراءة.
> الحذف نهائي.

---

## بعد الانتهاء

**غيّر كلمة سر `no-reply@hcsyria.org`** ثم حدّث `smtp.pass` في
`api/config.php`. الكلمة الحالية مرّت في محادثة، فتغييرها بعد استقرار
النظام إجراء صحّي لا أكثر.
