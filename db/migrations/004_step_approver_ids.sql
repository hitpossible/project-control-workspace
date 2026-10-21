-- =====================================================================
-- Approval steps: several picked approvers per step (any one may act)
-- =====================================================================
ALTER TABLE approval_steps ADD COLUMN approver_ids JSON NULL AFTER approver_id;

UPDATE app_settings SET description = 'Picked approvers (profile ids, any one may act) per fixed approval step: ss_receive, ss_gm_approve, ss_fm_approve, final_approve'
 WHERE `key` = 'approval_route_approvers';
