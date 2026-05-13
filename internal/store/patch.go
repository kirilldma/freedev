package store

func (s *Store) patchSchema() {
	_, _ = s.db.Exec(`ALTER TABLE projects ADD COLUMN archived INTEGER NOT NULL DEFAULT 0`)
}
