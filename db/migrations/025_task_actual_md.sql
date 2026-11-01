-- =====================================================================
-- Actual effort per task: the man-days the work really took, entered when the task is completed
-- (required for a task without sub-tasks; a parent task holds the sum of its sub-tasks).
-- Compared on the project with the estimate from the request review plus approved change requests.
-- =====================================================================
ALTER TABLE internal_tasks ADD COLUMN actual_md DECIMAL(6,1) NULL AFTER progress;
