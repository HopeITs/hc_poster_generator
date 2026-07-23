-- التحقّق بعد نقل البيانات من D1 إلى MySQL.
--
--   mysql -u USER -p DBNAME < docs/verify-migration.sql
--
-- قارن الأرقام بما كان في D1 قبل النقل:
--   wrangler d1 execute studyzone-db --remote --command \
--     "SELECT (SELECT COUNT(*) FROM users) u, (SELECT COUNT(*) FROM projects) p"
--
-- الجلسات ومحاولات الدخول لا تُنقَل عمداً، فلا تتوقّع لهما صفوفاً.

SELECT 'counts' AS check_name;
SELECT
  (SELECT COUNT(*) FROM users)                          AS users,
  (SELECT COUNT(*) FROM projects)                       AS projects,
  (SELECT COUNT(*) FROM user_projects)                  AS links,
  (SELECT COUNT(*) FROM users WHERE photo IS NOT NULL)  AS photos;

-- العربية: أي حرف ظهر كـ'?' أو مربّع يعني أن الترميز ضاع في الاستيراد
SELECT 'arabic survived' AS check_name;
SELECT id, name, slug FROM projects ORDER BY id;

-- صيغة PBKDF2: saltHex(32) + ':' + hashHex(64) = 97 محرفاً بالضبط.
-- أي صف مخالف يعني كلمة سر لن تعمل — ولا يمكن إصلاحها إلا بإعادة تعيين.
SELECT 'password format' AS check_name;
SELECT COUNT(*) AS bad_password_rows
  FROM users
 WHERE CHAR_LENGTH(password) <> 97
    OR password NOT LIKE '%:%';

-- الأدوار المعروفة فقط
SELECT 'roles' AS check_name;
SELECT role, COUNT(*) AS n FROM users GROUP BY role ORDER BY role;

-- الصور: data URL كاملة لا مقطوعة
SELECT 'photos intact' AS check_name;
SELECT email,
       CHAR_LENGTH(photo) AS len,
       (photo LIKE 'data:image/%;base64,%') AS well_formed
  FROM users WHERE photo IS NOT NULL;

-- brand_json يجب أن يبقى JSON صالحاً. الخطر هنا الشرطة المائلة العكسية:
-- MySQL تبتلعها ما لم يُضبط NO_BACKSLASH_ESCAPES أثناء الاستيراد، وهو ما
-- يفعله tools/d1-to-mysql.py.
SELECT 'brand_json valid' AS check_name;
SELECT id, name, JSON_VALID(brand_json) AS valid FROM projects ORDER BY id;

-- مراجع معلّقة: مستخدم يشير إلى مشروع غير موجود
SELECT 'orphan references' AS check_name;
SELECT COUNT(*) AS orphan_users
  FROM users u
 WHERE u.project_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM projects p WHERE p.id = u.project_id);
SELECT COUNT(*) AS orphan_links
  FROM user_projects up
 WHERE NOT EXISTS (SELECT 1 FROM projects p WHERE p.id = up.project_id)
    OR NOT EXISTS (SELECT 1 FROM users   u WHERE u.email = up.email);

-- المستلم في notify_to يجب أن يوجد كمستخدم أيضاً ليستطيع الدخول
SELECT 'notify recipient exists' AS check_name;
SELECT COUNT(*) AS hekmat_rows FROM users WHERE email = 'hekmat.jouby@hcsyria.org';
