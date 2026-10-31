-- =====================================================================
-- Personal access tokens: let a user's own tools (e.g. an AI assistant via the MCP server in mcp/)
-- read their data without a browser session. Only the SHA-256 of the token is stored; the token itself
-- is shown once when it is created. Accepted only by routes that opt in (withApiUser in src/server/api.ts).
-- =====================================================================
CREATE TABLE api_tokens (
  id            INT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id       INT          NOT NULL,
  name          VARCHAR(100) NOT NULL,
  token_hash    CHAR(64)     NOT NULL,
  token_prefix  VARCHAR(16)  NOT NULL,          -- first characters, so the user can tell tokens apart
  expires_at    DATETIME(3)  NULL,
  last_used_at  DATETIME(3)  NULL,
  revoked_at    DATETIME(3)  NULL,
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY api_tokens_hash_uq (token_hash),
  KEY api_tokens_user_idx (user_id),
  CONSTRAINT api_tokens_user_fk FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
