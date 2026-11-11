# Text Transcription API — دليل المبرمج

يقرأ النص من الصور وملفات PDF ويعيده كنص، بالعربي والإنكليزي. ويقدر يقرأ خانات الوثائق
(بطاقة شخصية، جواز سفر…) والفواتير.

## قبل البدء

- **المفتاح:** يعطيك إياه فريق HC Generator، وهو بالشكل `hct_…`.
- **المفتاح يبقى على السيرفر فقط:** ضعه بملف إعدادات أو متغير بيئة، ولا تضعه أبداً بكود
  JavaScript يصل للمتصفح. أي شخص يرى المفتاح يقدر يستخدم حصتك.
- **الحد اليومي:** لكل مفتاح 10 طلبات خلال آخر 24 ساعة.
- **الخصوصية:** لا يُحفظ شيء من الملفات أو النص عندنا، فهي تُقرأ ثم تُحذف.

## الطلب

```
POST https://studyzone-auth.ct-aleppo3.workers.dev/api/v1/transcribe
Authorization: Bearer hct_…
Content-Type: multipart/form-data
```

| الحقل | القيمة |
|---|---|
| `files` | من ملف إلى 6 ملفات: JPEG أو PNG أو WebP أو HEIC أو PDF، و30 MB كحد أقصى للمجموع. كرّر الحقل لكل ملف. |
| `mode` | `text` (الافتراضي): النص فقط. `doc`: كل ملف وثيقة رسمية، فيعيد خاناتها. `auto`: يقرر لكل ملف إن كان وثيقة أو نصاً. `invoice`: فاتورة، فيعيد التاريخ والرقم والتفاصيل بالإنكليزي والمبلغ. |
| `lang` | `ara+eng` (الافتراضي) أو `ara` أو `eng`: لغة النص الغالبة. |

ملف PDF يُقرأ كاملاً كملف واحد، وقبل كل صفحة بعد الأولى سطر `— صفحة N —`.

## الرد

قراءة الملفات قد تأخذ من بضع ثوانٍ إلى دقيقة أو أكثر لملف PDF طويل. لذلك يبدأ الرد
بمسافات فارغة ليبقى الاتصال مفتوحاً، ثم يأتي الـ JSON. أي قارئ JSON عادي يتجاهل
المسافات. اجعل مهلة الطلب عندك 3 دقائق على الأقل.

```json
{
  "ok": true,
  "mode": "doc",
  "files": [
    {
      "name": "id-front.jpg",
      "text": "الجمهورية العربية السورية\n…",
      "kind": "document",
      "docType": "بطاقة شخصية سورية — الوجه",
      "fields": [
        { "label": "الاسم", "value": "…" },
        { "label": "الرقم الوطني", "value": "…" }
      ]
    }
  ],
  "lite": false
}
```

- **`files`:** نتيجة لكل ملف، بنفس ترتيب الإرسال.
- **`kind`:** `text` أو `document`. مع `mode=text` تكون دائماً `text`، و`fields` فارغة.
- **مع `mode=invoice`:** تحمل `fields` دائماً أربع خانات بهذا الترتيب: «تاريخ الفاتورة»،
  «رقم الفاتورة»، «تفاصيل الفاتورة (انكليزي)»، «المبلغ الإجمالي».
- **كلمة لم تُقرأ:** تظهر `[…]`.
- **`lite: true`:** النموذج الأساسي كان مشغولاً فقرأ نموذج أخف. النتيجة أقل دقة، خاصة
  بالأرقام، فراجعها.

## الأخطاء

الفحوص الأولى ترجع فوراً برمز HTTP و`{ "error": "…", "code": "…" }`:

| HTTP | `code` | السبب |
|---|---|---|
| 401 | `unauthorized` | المفتاح ناقص أو خطأ أو موقوف |
| 400 | `bad_request`, `no_files`, `too_many_files`, `bad_mode`, `bad_lang` | الطلب غير صحيح |
| 413 | `too_large` | الملفات أكبر من 30 MB |
| 415 | `bad_type` | نوع ملف غير مدعوم |
| 429 | `daily_limit` | انتهى عدد الطلبات المسموح لآخر 24 ساعة |
| 503 | `unavailable` | الخدمة غير مضبوطة عندنا |

إذا فشلت القراءة نفسها بعد بدء الرد، يكون الرمز 200 والـ JSON:
`{ "error": "…", "code": "failed" }`. لذلك تحقق دائماً من `ok`.

## أمثلة

### curl

```bash
curl -X POST https://studyzone-auth.ct-aleppo3.workers.dev/api/v1/transcribe \
  -H "Authorization: Bearer $HCT_API_KEY" \
  -F "mode=doc" -F "lang=ara" \
  -F "files=@id-front.jpg" -F "files=@id-back.jpg"
```

### PHP

```php
<?php
$key = getenv('HCT_API_KEY');   // من إعدادات السيرفر، لا من الكود
$ch = curl_init('https://studyzone-auth.ct-aleppo3.workers.dev/api/v1/transcribe');
curl_setopt_array($ch, [
  CURLOPT_POST => true,
  CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . $key],
  CURLOPT_POSTFIELDS => [
    'mode' => 'text',
    'lang' => 'ara+eng',
    'files[0]' => new CURLFile($_FILES['scan']['tmp_name'], $_FILES['scan']['type'], $_FILES['scan']['name']),
  ],
  CURLOPT_RETURNTRANSFER => true,
  CURLOPT_TIMEOUT => 180,
]);
$body = curl_exec($ch);
$status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

$res = json_decode(trim($body), true);
if ($status !== 200 || empty($res['ok'])) {
  // $res['code'] و $res['error'] يشرحان السبب
} else {
  foreach ($res['files'] as $f) { echo $f['text']; }
}
```

> ملاحظة PHP: لعدة ملفات استعمل `files[0]` و`files[1]`… فالخدمة تقبل هذه الأسماء، كما تقبل
> `files` مكرراً.

### Node.js (18 أو أحدث)

```js
import { readFile } from "node:fs/promises";

const form = new FormData();
form.append("mode", "invoice");
form.append("files", new Blob([await readFile("invoice.pdf")], { type: "application/pdf" }), "invoice.pdf");

const r = await fetch("https://studyzone-auth.ct-aleppo3.workers.dev/api/v1/transcribe", {
  method: "POST",
  headers: { Authorization: "Bearer " + process.env.HCT_API_KEY },
  body: form,
  signal: AbortSignal.timeout(180000),
});
const res = JSON.parse((await r.text()).trim());
if (!res.ok) throw new Error(res.code + ": " + res.error);
console.log(res.files[0].fields);
```
