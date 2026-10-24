-- =====================================================================
-- Design diagrams are one canvas with flowchart shapes and ER tables side by side,
-- so a diagram no longer has a kind. The AI is still asked for one kind per draft.
-- =====================================================================
SET NAMES utf8mb4;

ALTER TABLE project_diagrams DROP COLUMN kind;
