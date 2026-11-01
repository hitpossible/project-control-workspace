-- =====================================================================
-- Project meetings: schedule each round, invite by e-mail, record the MOM and keep what was learned for analysis.
--   planned → held (MOM recorded) | cancelled. Structured parts (agenda, attendees, MOM lists) are JSON documents of the meeting.
--   meeting_invitations is the log of every e-mail sent (invitation / update / cancellation / MOM) with its subject and body.
--   email_outbox.ics carries the calendar invitation (iCalendar text) for the mail sender.
--   Workflow in src/server/rpc/meetings.ts, pure logic in src/lib/meetings.ts.
-- =====================================================================
SET NAMES utf8mb4;

CREATE TABLE project_meetings (
  id               INT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
  project_id       INT          NOT NULL,
  meeting_no       INT          NOT NULL,                 -- round number per project
  title            VARCHAR(300) NOT NULL,
  meeting_type     ENUM('kickoff','requirement','review','uat','status','other') NOT NULL DEFAULT 'requirement',
  status           ENUM('planned','held','cancelled') NOT NULL DEFAULT 'planned',
  start_at         DATETIME(3)  NOT NULL,                 -- UTC
  end_at           DATETIME(3)  NOT NULL,
  location         VARCHAR(300) NULL,
  online_link      VARCHAR(500) NULL,
  organizer_id     INT          NULL,
  purpose          TEXT         NULL,                     -- what the meeting is for / information it should cover
  agenda           JSON         NOT NULL,                 -- [{title, minutes}]
  attendees        JSON         NOT NULL,                 -- [{user_id, name, email, attended}]
  mom_summary      TEXT         NULL,
  mom_discussion   JSON         NOT NULL,                 -- [{topic, notes}] per agenda item
  mom_decisions    JSON         NOT NULL,                 -- [text]
  mom_actions      JSON         NOT NULL,                 -- [{text, owner_id, owner_name, due_date, task_id}]
  mom_questions    JSON         NOT NULL,                 -- [text] open questions
  mom_info         JSON         NOT NULL,                 -- [{topic, detail}] information obtained, read by the AI analysis
  mom_recorded_at  DATETIME(3)  NULL,
  mom_recorded_by  INT          NULL,
  created_by       INT          NULL,
  created_at       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_by       INT          NULL,
  UNIQUE KEY project_meetings_no_uq (project_id, meeting_no),
  KEY project_meetings_start_idx (project_id, start_at),
  CONSTRAINT project_meetings_project_fk FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT project_meetings_organizer_fk FOREIGN KEY (organizer_id) REFERENCES profiles(id),
  CONSTRAINT project_meetings_createdby_fk FOREIGN KEY (created_by) REFERENCES profiles(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE meeting_invitations (
  id           INT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
  meeting_id   INT          NOT NULL,
  project_id   INT          NOT NULL,
  kind         ENUM('invite','update','cancel','mom') NOT NULL DEFAULT 'invite',
  recipients   JSON         NOT NULL,                     -- [{name, email}]
  subject      VARCHAR(500) NOT NULL,
  body         TEXT         NOT NULL,
  with_ics     TINYINT(1)   NOT NULL DEFAULT 0,
  ai_drafted   TINYINT(1)   NOT NULL DEFAULT 0,
  sent_by      INT          NULL,
  sent_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY meeting_invitations_meeting_idx (meeting_id, sent_at),
  CONSTRAINT meeting_invitations_meeting_fk FOREIGN KEY (meeting_id) REFERENCES project_meetings(id) ON DELETE CASCADE,
  CONSTRAINT meeting_invitations_project_fk FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT meeting_invitations_sender_fk FOREIGN KEY (sent_by) REFERENCES profiles(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE email_outbox ADD COLUMN ics TEXT NULL AFTER body;
