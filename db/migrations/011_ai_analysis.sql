-- =====================================================================
-- AI initial analysis: once a request is submitted, the company LLM reads the form,
-- the clarification summary and the conversation, and writes a first assessment for
-- System Service — complexity, readiness, effort, suggested modules, risks, next step.
-- =====================================================================
SET NAMES utf8mb4;

-- {status: pending|done|failed, analyzed_at, complexity, readiness, effort_min, effort_max, modules[], risks[], next_step}
-- see AiAnalysis in src/lib/clarify.ts
ALTER TABLE project_requests
  ADD COLUMN ai_analysis JSON NULL AFTER ai_chat;
