-- =====================================================================
-- Working days: work week + company holidays — used when scheduling template
-- activities at Convert and for delay / schedule variance (in working days)
-- =====================================================================
SET NAMES utf8mb4;

INSERT IGNORE INTO app_settings(`key`, value, description) VALUES
  ('work_week', '[1,2,3,4,5]', 'Working weekdays (0 = Sunday … 6 = Saturday) — Admin → Working Days');

CREATE TABLE company_holidays (
  id            INT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
  holiday_date  DATE         NOT NULL,
  name          VARCHAR(150) NOT NULL,
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY company_holidays_date_uq (holiday_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
