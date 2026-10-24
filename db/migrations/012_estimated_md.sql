-- =====================================================================
-- Reviewer's effort estimate: System Service enters the expected man-days when it
-- receives a request, next to the AI's estimate (ai_analysis), so the two can be compared.
-- =====================================================================
SET NAMES utf8mb4;

ALTER TABLE project_requests
  ADD COLUMN estimated_md DECIMAL(6,1) NULL AFTER scope_assessment;
