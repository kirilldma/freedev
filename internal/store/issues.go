package store

import (
	"database/sql"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
)

type Issue struct {
	ID        string `json:"id"`
	ProjectID string `json:"project_id"`
	Title     string `json:"title"`
	Body      string `json:"body"`
	Status    string `json:"status"`
	Priority  int    `json:"priority"`
	CreatedAt int64  `json:"created_at"`
	UpdatedAt int64  `json:"updated_at"`
}

func (s *Store) issueMigrate() error {
	_, err := s.db.Exec(`
CREATE TABLE IF NOT EXISTS issues (
	id TEXT PRIMARY KEY,
	project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
	title TEXT NOT NULL,
	body TEXT DEFAULT '',
	status TEXT NOT NULL DEFAULT 'open',
	priority INTEGER NOT NULL DEFAULT 0,
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_issues_project ON issues(project_id);
CREATE INDEX IF NOT EXISTS idx_issues_status ON issues(status);
`)
	return err
}

func (s *Store) ListIssues(projectID string, limit int) ([]Issue, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	rows, err := s.db.Query(`
SELECT id, project_id, title, body, status, priority, created_at, updated_at
FROM issues WHERE project_id=? ORDER BY priority DESC, updated_at DESC LIMIT ?
`, projectID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanIssues(rows)
}

func scanIssues(rows *sql.Rows) ([]Issue, error) {
	var out []Issue
	for rows.Next() {
		var x Issue
		if err := rows.Scan(&x.ID, &x.ProjectID, &x.Title, &x.Body, &x.Status, &x.Priority, &x.CreatedAt, &x.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, x)
	}
	return out, rows.Err()
}

func (s *Store) CreateIssue(projectID, title, body string, priority int) (Issue, error) {
	id := uuid.NewString()
	ts := time.Now().UnixMilli()
	title = strings.TrimSpace(title)
	if title == "" {
		return Issue{}, errors.New("title required")
	}
	_, err := s.db.Exec(`
INSERT INTO issues(id,project_id,title,body,status,priority,created_at,updated_at)
VALUES(?,?,?,?,?,?,?,?)
`, id, projectID, title, body, "open", priority, ts, ts)
	if err != nil {
		return Issue{}, err
	}
	return Issue{ID: id, ProjectID: projectID, Title: title, Body: body, Status: "open", Priority: priority, CreatedAt: ts, UpdatedAt: ts}, nil
}

func (s *Store) GetIssue(id string) (Issue, bool, error) {
	var x Issue
	err := s.db.QueryRow(`
SELECT id, project_id, title, body, status, priority, created_at, updated_at FROM issues WHERE id=? LIMIT 1
`, id).Scan(&x.ID, &x.ProjectID, &x.Title, &x.Body, &x.Status, &x.Priority, &x.CreatedAt, &x.UpdatedAt)
	if err == sql.ErrNoRows {
		return Issue{}, false, nil
	}
	if err != nil {
		return Issue{}, false, err
	}
	return x, true, nil
}

func (s *Store) UpdateIssue(id string, title, body, status *string, priority *int) (Issue, bool, error) {
	x, ok, err := s.GetIssue(id)
	if err != nil || !ok {
		return Issue{}, ok, err
	}
	ts := time.Now().UnixMilli()
	if title != nil {
		t := strings.TrimSpace(*title)
		if t != "" {
			x.Title = t
		}
	}
	if body != nil {
		x.Body = *body
	}
	if status != nil {
		st := strings.TrimSpace(strings.ToLower(*status))
		if st != "" {
			x.Status = st
		}
	}
	if priority != nil {
		x.Priority = *priority
	}
	_, err = s.db.Exec(`UPDATE issues SET title=?, body=?, status=?, priority=?, updated_at=? WHERE id=?`,
		x.Title, x.Body, x.Status, x.Priority, ts, id)
	if err != nil {
		return Issue{}, false, err
	}
	x.UpdatedAt = ts
	return x, true, nil
}

func (s *Store) DeleteIssue(id string) error {
	_, err := s.db.Exec(`DELETE FROM issues WHERE id=?`, id)
	return err
}

func (s *Store) CountIssuesOpen(projectID string) (int64, error) {
	var n int64
	err := s.db.QueryRow(`
SELECT COUNT(*) FROM issues WHERE project_id=? AND lower(trim(status))='open'
`, projectID).Scan(&n)
	return n, err
}

func (s *Store) CountIssuesTotal() (int64, error) {
	var n int64
	err := s.db.QueryRow(`SELECT COUNT(*) FROM issues`).Scan(&n)
	return n, err
}
