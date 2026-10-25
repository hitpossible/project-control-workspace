-- =====================================================================
-- Session revocation: every session token carries the user's session_version from when it was issued;
-- bumping the number (sign out everywhere, admin "force sign-out", password set by an admin) rejects all older tokens.
-- =====================================================================
ALTER TABLE profiles ADD COLUMN session_version INT NOT NULL DEFAULT 0;
