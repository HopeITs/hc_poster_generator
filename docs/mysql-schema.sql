-- مخطط MySQL لتطبيق post-gen — بديل Cloudflare D1
--
-- utf8mb4 إلزامي: الأسماء والمشاريع بالعربية، و utf8 القديم (3 بايت) يفسدها.
-- ترتيب الإنشاء مهم: projects قبل users لأن users تشير إليها.

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS projects (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  name          VARCHAR(191) NOT NULL,
  slug          VARCHAR(191) NOT NULL,
  brand_json    TEXT         NOT NULL,          -- ألوان/شعار/اسم/بادئة الملف
  template_type VARCHAR(50)  NOT NULL,          -- studyzone_v1, hopecenter_v1, ...
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status        VARCHAR(20)  NOT NULL DEFAULT 'soon',
  UNIQUE KEY uq_projects_slug (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS users (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  -- VARCHAR لا TEXT: MySQL لا تقبل فهرساً فريداً على TEXT بلا طول بادئة
  email      VARCHAR(255) NOT NULL,
  -- صيغة PBKDF2: saltHex(32) + ':' + hashHex(64) = 97 محرفاً
  password   VARCHAR(255) NOT NULL,
  role       VARCHAR(20)  NOT NULL,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  project_id INT          NULL,
  -- صورة شخصية كـdata URL، ‎256×256‎ JPEG ≈ 7KB. MEDIUMTEXT يعطي هامشاً واسعاً.
  photo      MEDIUMTEXT   NULL,
  UNIQUE KEY uq_users_email (email),
  KEY idx_users_project (project_id),
  CONSTRAINT fk_users_project FOREIGN KEY (project_id)
    REFERENCES projects(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_projects (
  email      VARCHAR(255) NOT NULL,
  project_id INT          NOT NULL,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (email, project_id),
  KEY idx_up_project (project_id),
  CONSTRAINT fk_up_project FOREIGN KEY (project_id)
    REFERENCES projects(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- الجلسات لا تُنقَل: الحالية توكنات في localStorage والجديدة كوكيز،
-- فيسجّل الجميع دخولاً مرة واحدة — وهذا ما يُغلق ثغرة localStorage.
CREATE TABLE IF NOT EXISTS sessions (
  token      CHAR(64)     NOT NULL PRIMARY KEY,   -- 32 بايت عشوائية بصيغة hex
  email      VARCHAR(255) NOT NULL,
  expires_at DATETIME     NOT NULL,
  KEY idx_sessions_email (email),
  KEY idx_sessions_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS login_attempts (
  id    BIGINT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  ip    VARCHAR(45)  NOT NULL DEFAULT '',        -- 45 ليتّسع IPv6
  at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_la_email (email, at),
  KEY idx_la_ip (ip, at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
