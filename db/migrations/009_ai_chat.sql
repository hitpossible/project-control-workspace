-- =====================================================================
-- AI clarification as a chat: the requestor talks with the AI before submit until
-- the document type's criteria are covered. The transcript is kept on the request;
-- ai_coverage.criteria[].summary holds the requestor-confirmed summary per criterion.
-- =====================================================================
SET NAMES utf8mb4;

-- [{role: assistant|user, content, at, criteria?: [criterion keys the message asks about]}]
ALTER TABLE project_requests
  ADD COLUMN ai_chat JSON NULL AFTER ai_coverage;
