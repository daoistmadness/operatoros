BEGIN IMMEDIATE;
CREATE TABLE IF NOT EXISTS first_admin_setup_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  completed BOOLEAN NOT NULL DEFAULT 0,
  completed_at TIMESTAMP NULL,
  created_user_id INTEGER NULL,
  normalized_username VARCHAR(255) NULL,
  provisioning_source VARCHAR(32) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(created_user_id) REFERENCES users(id) ON DELETE RESTRICT
);
INSERT OR IGNORE INTO first_admin_setup_state(id, completed) VALUES (1, 0);
COMMIT;
