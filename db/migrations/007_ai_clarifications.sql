-- =====================================================================
-- AI clarifications: before a request is submitted, the company LLM reads
-- the form and asks the requestor what is still missing about the project.
-- The questions and answers stay with the request for the approvers / System Service.
-- =====================================================================
SET NAMES utf8mb4;

-- [{question, answer, asked_at}] — answer null = skipped by the requestor
ALTER TABLE project_requests
  ADD COLUMN ai_clarifications JSON NULL AFTER reduction_cost_to;
