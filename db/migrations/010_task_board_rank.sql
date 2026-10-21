-- Kanban order of internal tasks within a status column, shared by the team.
-- NULL = never arranged: the board falls back to due date. Moving a card sets its rank to the
-- midpoint of its new neighbours, so a reorder only ever writes one row.
ALTER TABLE internal_tasks ADD COLUMN board_rank DOUBLE NULL AFTER seq;
