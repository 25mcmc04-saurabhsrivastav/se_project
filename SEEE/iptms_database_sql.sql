-- =============================================================
-- Internal Project & Task Management System (IPTMS)
-- MariaDB 10.11.16 compatible version
-- =============================================================

CREATE DATABASE IF NOT EXISTS iptms_db;

USE iptms_db;

SET NAMES utf8mb4;

-- -------------------------------------------------------------
-- 1. USERS
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    user_id       INT UNSIGNED NOT NULL AUTO_INCREMENT,
    name          VARCHAR(100) NOT NULL,
    email         VARCHAR(150) NOT NULL,
    password      VARCHAR(255) NOT NULL COMMENT 'Store PHP password_hash() output only',
    role          ENUM('admin', 'project_lead', 'employee') NOT NULL DEFAULT 'employee',
    department    VARCHAR(100) DEFAULT NULL,
    designation   VARCHAR(100) DEFAULT NULL,
    status        ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
    created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id),
    UNIQUE KEY uq_users_email (email),
    KEY idx_users_role_status (role, status),
    KEY idx_users_department (department)
) ENGINE=InnoDB;

-- -------------------------------------------------------------
-- 2. TEAMS
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS teams (
    team_id       INT UNSIGNED NOT NULL AUTO_INCREMENT,
    team_name     VARCHAR(100) NOT NULL,
    description   TEXT DEFAULT NULL,
    team_lead_id  INT UNSIGNED DEFAULT NULL,
    created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (team_id),
    UNIQUE KEY uq_teams_team_name (team_name),
    KEY idx_teams_team_lead (team_lead_id),
    CONSTRAINT fk_teams_team_lead
      FOREIGN KEY (team_lead_id) REFERENCES users(user_id)
      ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB;

-- -------------------------------------------------------------
-- 3. TEAM MEMBERS
-- Allows a user to belong to multiple teams and preserves
-- inactive membership records.
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS team_members (
    team_member_id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    team_id        INT UNSIGNED NOT NULL,
    user_id        INT UNSIGNED NOT NULL,
    joined_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    status         ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
    -- Maintained by BEFORE INSERT/UPDATE triggers below.
    active_user_id INT UNSIGNED DEFAULT NULL,
    PRIMARY KEY (team_member_id),
    UNIQUE KEY uq_team_members_active (team_id, active_user_id),
    KEY idx_team_members_user_status (user_id, status),
    CONSTRAINT fk_team_members_team
      FOREIGN KEY (team_id) REFERENCES teams(team_id)
      ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_team_members_user
      FOREIGN KEY (user_id) REFERENCES users(user_id)
      ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB;

-- -------------------------------------------------------------
-- 4. PROJECTS
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS projects (
    project_id    INT UNSIGNED NOT NULL AUTO_INCREMENT,
    project_name  VARCHAR(150) NOT NULL,
    description   TEXT DEFAULT NULL,
    lead_id       INT UNSIGNED NOT NULL,
    start_date    DATE DEFAULT NULL,
    end_date      DATE DEFAULT NULL,
    status        ENUM('planning', 'active', 'on_hold', 'completed', 'cancelled')
                  NOT NULL DEFAULT 'planning',
    created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (project_id),
    KEY idx_projects_lead_status (lead_id, status),
    KEY idx_projects_status_dates (status, start_date, end_date),
    CONSTRAINT fk_projects_lead
      FOREIGN KEY (lead_id) REFERENCES users(user_id)
      ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT chk_projects_date_range
      CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date)
) ENGINE=InnoDB;

-- -------------------------------------------------------------
-- 5. PROJECT MEMBERS
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS project_members (
    project_member_id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    project_id        INT UNSIGNED NOT NULL,
    user_id           INT UNSIGNED NOT NULL,
    joined_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    status            ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
    -- Maintained by BEFORE INSERT/UPDATE triggers below.
    active_user_id    INT UNSIGNED DEFAULT NULL,
    PRIMARY KEY (project_member_id),
    UNIQUE KEY uq_project_members_active (project_id, active_user_id),
    KEY idx_project_members_user_status (user_id, status),
    CONSTRAINT fk_project_members_project
      FOREIGN KEY (project_id) REFERENCES projects(project_id)
      ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_project_members_user
      FOREIGN KEY (user_id) REFERENCES users(user_id)
      ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB;

-- -------------------------------------------------------------
-- 6. TASKS
-- owner is intentionally not stored here. The current owner is
-- represented by an active task_assignments row with role 'owner'.
-- progress_percent is the manual value used only when no subtasks
-- exist. The views below calculate effective progress.
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tasks (
    task_id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
    project_id       INT UNSIGNED NOT NULL,
    title            VARCHAR(200) NOT NULL,
    description      TEXT DEFAULT NULL,
    priority         ENUM('low', 'medium', 'high', 'urgent') NOT NULL DEFAULT 'medium',
    status           ENUM('not_started', 'in_progress', 'in_review', 'completed', 'blocked')
                     NOT NULL DEFAULT 'not_started',
    estimated_hours  DECIMAL(8,2) NOT NULL DEFAULT 1.00,
    progress_percent DECIMAL(5,2) NOT NULL DEFAULT 0.00
                     COMMENT 'Manual progress used when task has no subtasks',
    start_date       DATE DEFAULT NULL,
    due_date         DATE DEFAULT NULL,
    created_by       INT UNSIGNED DEFAULT NULL,
    created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (task_id),
    KEY idx_tasks_project_status (project_id, status),
    KEY idx_tasks_due_date (due_date),
    KEY idx_tasks_priority_status (priority, status),
    KEY idx_tasks_created_by (created_by),
    CONSTRAINT fk_tasks_project
      FOREIGN KEY (project_id) REFERENCES projects(project_id)
      ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_tasks_created_by
      FOREIGN KEY (created_by) REFERENCES users(user_id)
      ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT chk_tasks_estimated_hours CHECK (estimated_hours > 0),
    CONSTRAINT chk_tasks_progress CHECK (progress_percent >= 0 AND progress_percent <= 100),
    CONSTRAINT chk_tasks_date_range
      CHECK (due_date IS NULL OR start_date IS NULL OR due_date >= start_date)
) ENGINE=InnoDB;

-- -------------------------------------------------------------
-- 7. TASK ASSIGNMENTS
-- Supports multiple active assignees, one active owner per task,
-- and retained assignment history through removed_at.
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS task_assignments (
    assignment_id      INT UNSIGNED NOT NULL AUTO_INCREMENT,
    task_id            INT UNSIGNED NOT NULL,
    user_id            INT UNSIGNED NOT NULL,
    assignment_role    ENUM('owner', 'contributor') NOT NULL DEFAULT 'contributor',
    assigned_by        INT UNSIGNED DEFAULT NULL,
    assigned_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    removed_at         DATETIME DEFAULT NULL,
    -- Both columns are maintained by BEFORE INSERT/UPDATE triggers below.
    active_user_id       INT UNSIGNED DEFAULT NULL,
    active_owner_task_id INT UNSIGNED DEFAULT NULL,
    PRIMARY KEY (assignment_id),
    UNIQUE KEY uq_task_assignments_active_user (task_id, active_user_id),
    UNIQUE KEY uq_task_assignments_active_owner (active_owner_task_id),
    KEY idx_task_assignments_user_active (user_id, removed_at),
    KEY idx_task_assignments_assigned_by (assigned_by),
    CONSTRAINT fk_task_assignments_task
      FOREIGN KEY (task_id) REFERENCES tasks(task_id)
      ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_task_assignments_user
      FOREIGN KEY (user_id) REFERENCES users(user_id)
      ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_task_assignments_assigned_by
      FOREIGN KEY (assigned_by) REFERENCES users(user_id)
      ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT chk_task_assignments_removed_date
      CHECK (removed_at IS NULL OR removed_at >= assigned_at)
) ENGINE=InnoDB;

-- -------------------------------------------------------------
-- 8. SUBTASKS
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS subtasks (
    subtask_id       INT UNSIGNED NOT NULL AUTO_INCREMENT,
    task_id          INT UNSIGNED NOT NULL,
    title            VARCHAR(200) NOT NULL,
    description      TEXT DEFAULT NULL,
    assignee_id      INT UNSIGNED DEFAULT NULL,
    estimated_hours  DECIMAL(8,2) NOT NULL DEFAULT 1.00,
    progress_percent DECIMAL(5,2) NOT NULL DEFAULT 0.00,
    status           ENUM('not_started', 'in_progress', 'completed', 'blocked')
                     NOT NULL DEFAULT 'not_started',
    created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (subtask_id),
    KEY idx_subtasks_task_status (task_id, status),
    KEY idx_subtasks_assignee_status (assignee_id, status),
    CONSTRAINT fk_subtasks_task
      FOREIGN KEY (task_id) REFERENCES tasks(task_id)
      ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_subtasks_assignee
      FOREIGN KEY (assignee_id) REFERENCES users(user_id)
      ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT chk_subtasks_estimated_hours CHECK (estimated_hours > 0),
    CONSTRAINT chk_subtasks_progress CHECK (progress_percent >= 0 AND progress_percent <= 100)
) ENGINE=InnoDB;

-- -------------------------------------------------------------
-- 9. COMMENTS
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS comments (
    comment_id  INT UNSIGNED NOT NULL AUTO_INCREMENT,
    task_id     INT UNSIGNED NOT NULL,
    user_id     INT UNSIGNED NOT NULL,
    message     TEXT NOT NULL,
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (comment_id),
    KEY idx_comments_task_created (task_id, created_at),
    KEY idx_comments_user (user_id),
    CONSTRAINT fk_comments_task
      FOREIGN KEY (task_id) REFERENCES tasks(task_id)
      ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_comments_user
      FOREIGN KEY (user_id) REFERENCES users(user_id)
      ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB;

-- -------------------------------------------------------------
-- 10. ATTACHMENTS
-- Actual file bytes are stored on the server filesystem, not in MySQL.
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS attachments (
    attachment_id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    task_id       INT UNSIGNED NOT NULL,
    uploaded_by   INT UNSIGNED NOT NULL,
    original_name VARCHAR(255) NOT NULL,
    stored_name   VARCHAR(255) NOT NULL,
    file_path     VARCHAR(500) NOT NULL,
    file_type     VARCHAR(100) DEFAULT NULL,
    file_size     BIGINT UNSIGNED NOT NULL,
    uploaded_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (attachment_id),
    KEY idx_attachments_task_uploaded (task_id, uploaded_at),
    KEY idx_attachments_uploaded_by (uploaded_by),
    CONSTRAINT fk_attachments_task
      FOREIGN KEY (task_id) REFERENCES tasks(task_id)
      ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_attachments_uploaded_by
      FOREIGN KEY (uploaded_by) REFERENCES users(user_id)
      ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB;

-- -------------------------------------------------------------
-- 11. NOTIFICATIONS
-- related_type + related_id is a polymorphic reference. It is
-- validated in PHP because it can point to different entity tables.
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
    notification_id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id         INT UNSIGNED NOT NULL,
    message         TEXT NOT NULL,
    related_type    VARCHAR(50) DEFAULT NULL,
    related_id      INT UNSIGNED DEFAULT NULL,
    is_read         BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (notification_id),
    KEY idx_notifications_user_read_created (user_id, is_read, created_at),
    KEY idx_notifications_related (related_type, related_id),
    CONSTRAINT fk_notifications_user
      FOREIGN KEY (user_id) REFERENCES users(user_id)
      ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB;

-- -------------------------------------------------------------
-- 12. ACTIVITY LOGS
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS activity_logs (
    activity_id  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id      INT UNSIGNED DEFAULT NULL,
    action       VARCHAR(100) NOT NULL,
    entity_type  VARCHAR(50) NOT NULL,
    entity_id    INT UNSIGNED NOT NULL,
    details      JSON DEFAULT NULL,
    created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (activity_id),
    KEY idx_activity_entity (entity_type, entity_id, created_at),
    KEY idx_activity_user_created (user_id, created_at),
    KEY idx_activity_action_created (action, created_at),
    CONSTRAINT fk_activity_logs_user
      FOREIGN KEY (user_id) REFERENCES users(user_id)
      ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB;

-- -------------------------------------------------------------
-- 13. MEMBER REQUESTS
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS member_requests (
    request_id    INT UNSIGNED NOT NULL AUTO_INCREMENT,
    task_id       INT UNSIGNED NOT NULL,
    requested_by  INT UNSIGNED NOT NULL,
    reason        TEXT NOT NULL,
    status        ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'pending',
    handled_by    INT UNSIGNED DEFAULT NULL,
    handled_at    DATETIME DEFAULT NULL,
    created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (request_id),
    KEY idx_member_requests_task_status (task_id, status),
    KEY idx_member_requests_requested_by (requested_by, created_at),
    KEY idx_member_requests_handler (handled_by, handled_at),
    CONSTRAINT fk_member_requests_task
      FOREIGN KEY (task_id) REFERENCES tasks(task_id)
      ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_member_requests_requested_by
      FOREIGN KEY (requested_by) REFERENCES users(user_id)
      ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_member_requests_handled_by
      FOREIGN KEY (handled_by) REFERENCES users(user_id)
      ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT chk_member_requests_handled
      CHECK (
        (status = 'pending' AND handled_at IS NULL)
        OR
        (status IN ('approved', 'rejected') AND handled_at IS NOT NULL)
      )
) ENGINE=InnoDB;


-- -------------------------------------------------------------
-- TRIGGERS: maintain active-membership/assignment helper columns
-- MariaDB 10.11 does not allow the original generated-column
-- expressions to reference these foreign-key columns. These
-- ordinary columns plus triggers preserve the same unique rules.
-- -------------------------------------------------------------

DROP TRIGGER IF EXISTS trg_team_members_insert;
DROP TRIGGER IF EXISTS trg_team_members_update;
DROP TRIGGER IF EXISTS trg_project_members_insert;
DROP TRIGGER IF EXISTS trg_project_members_update;
DROP TRIGGER IF EXISTS trg_task_assignments_insert;
DROP TRIGGER IF EXISTS trg_task_assignments_update;

DELIMITER //

CREATE TRIGGER trg_team_members_insert
BEFORE INSERT ON team_members
FOR EACH ROW
BEGIN
    SET NEW.active_user_id =
        CASE WHEN NEW.status = 'active' THEN NEW.user_id ELSE NULL END;
END//

CREATE TRIGGER trg_team_members_update
BEFORE UPDATE ON team_members
FOR EACH ROW
BEGIN
    SET NEW.active_user_id =
        CASE WHEN NEW.status = 'active' THEN NEW.user_id ELSE NULL END;
END//

CREATE TRIGGER trg_project_members_insert
BEFORE INSERT ON project_members
FOR EACH ROW
BEGIN
    SET NEW.active_user_id =
        CASE WHEN NEW.status = 'active' THEN NEW.user_id ELSE NULL END;
END//

CREATE TRIGGER trg_project_members_update
BEFORE UPDATE ON project_members
FOR EACH ROW
BEGIN
    SET NEW.active_user_id =
        CASE WHEN NEW.status = 'active' THEN NEW.user_id ELSE NULL END;
END//

CREATE TRIGGER trg_task_assignments_insert
BEFORE INSERT ON task_assignments
FOR EACH ROW
BEGIN
    SET NEW.active_user_id =
        CASE WHEN NEW.removed_at IS NULL THEN NEW.user_id ELSE NULL END;

    SET NEW.active_owner_task_id =
        CASE
            WHEN NEW.removed_at IS NULL AND NEW.assignment_role = 'owner'
            THEN NEW.task_id
            ELSE NULL
        END;
END//

CREATE TRIGGER trg_task_assignments_update
BEFORE UPDATE ON task_assignments
FOR EACH ROW
BEGIN
    SET NEW.active_user_id =
        CASE WHEN NEW.removed_at IS NULL THEN NEW.user_id ELSE NULL END;

    SET NEW.active_owner_task_id =
        CASE
            WHEN NEW.removed_at IS NULL AND NEW.assignment_role = 'owner'
            THEN NEW.task_id
            ELSE NULL
        END;
END//

DELIMITER ;

-- -------------------------------------------------------------
-- VIEWS: effective task and project progress
-- -------------------------------------------------------------

-- Task progress is derived from weighted subtask progress when
-- subtasks exist; otherwise the manually maintained task value is used.
-- Completed tasks always report 100% in this view.
CREATE OR REPLACE VIEW v_task_progress AS
SELECT
    t.task_id,
    t.project_id,
    t.title,
    t.status,
    t.estimated_hours,
    CASE
      WHEN t.status = 'completed' THEN 100.00
      WHEN COALESCE(sa.subtask_count, 0) > 0 THEN
        ROUND(sa.weighted_progress / sa.total_subtask_hours, 2)
      ELSE t.progress_percent
    END AS effective_progress_percent,
    COALESCE(sa.subtask_count, 0) AS subtask_count
FROM tasks AS t
LEFT JOIN (
    SELECT
        task_id,
        COUNT(*) AS subtask_count,
        SUM(estimated_hours) AS total_subtask_hours,
        SUM(
          estimated_hours *
          CASE WHEN status = 'completed' THEN 100.00 ELSE progress_percent END
        ) AS weighted_progress
    FROM subtasks
    GROUP BY task_id
) AS sa ON sa.task_id = t.task_id;

-- Project progress is the weighted average of non-cancelled tasks.
-- Projects with no eligible tasks report 0%.
CREATE OR REPLACE VIEW v_project_progress AS
SELECT
    p.project_id,
    p.project_name,
    p.status,
    COALESCE(
      ROUND(
        SUM(vtp.effective_progress_percent * vtp.estimated_hours)
        / NULLIF(SUM(vtp.estimated_hours), 0),
        2
      ),
      0.00
    ) AS project_progress_percent,
    COUNT(vtp.task_id) AS total_tasks,
    COALESCE(SUM(CASE WHEN vtp.status = 'completed' THEN 1 ELSE 0 END), 0) AS completed_tasks
FROM projects AS p
LEFT JOIN v_task_progress AS vtp
  ON vtp.project_id = p.project_id
  AND vtp.status <> 'cancelled'
GROUP BY p.project_id, p.project_name, p.status;

-- =============================================================
-- END OF IPTMS DATABASE SCRIPT
-- =============================================================
