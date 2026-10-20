-- =====================================================================
-- Request form: Reduction figures (From → To) replace the free-text
-- "Reduction / Benefit Details". The old benefit column is kept for existing data.
-- =====================================================================
SET NAMES utf8mb4;

ALTER TABLE project_requests
  ADD COLUMN reduction_time_from  DECIMAL(12,2) NULL AFTER benefit,   -- Time (Min / Month)
  ADD COLUMN reduction_time_to    DECIMAL(12,2) NULL AFTER reduction_time_from,
  ADD COLUMN reduction_man_from   DECIMAL(12,2) NULL AFTER reduction_time_to,    -- Man (Man / Month)
  ADD COLUMN reduction_man_to     DECIMAL(12,2) NULL AFTER reduction_man_from,
  ADD COLUMN reduction_cost_from  DECIMAL(14,2) NULL AFTER reduction_man_to,     -- Others Cost (THB)
  ADD COLUMN reduction_cost_to    DECIMAL(14,2) NULL AFTER reduction_cost_from;
