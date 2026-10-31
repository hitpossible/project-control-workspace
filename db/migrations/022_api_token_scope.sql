-- =====================================================================
-- Personal access token scope: 'read' tokens only read; 'write' tokens may also update the user's own
-- tasks / bugs through the same policies and workflow functions as the UI (POST /api/me/work/<type>/<id>).
-- =====================================================================
ALTER TABLE api_tokens ADD COLUMN scope ENUM('read','write') NOT NULL DEFAULT 'read' AFTER name;
