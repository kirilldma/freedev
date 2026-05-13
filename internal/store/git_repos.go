package store

import (
	"database/sql"
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	git "github.com/go-git/go-git/v5"
	"github.com/google/uuid"
)

var gitSlugRe = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,62}$`)

type GitRepo struct {
	ID        string `json:"id"`
	Slug      string `json:"slug"`
	Name      string `json:"name"`
	ProjectID string `json:"project_id,omitempty"`
	CreatedAt int64  `json:"created_at"`
}

func (s *Store) gitReposMigrate() error {
	_, err := s.db.Exec(`
CREATE TABLE IF NOT EXISTS git_repos (
	id TEXT PRIMARY KEY,
	slug TEXT NOT NULL UNIQUE,
	name TEXT NOT NULL,
	project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
	created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_git_repos_project ON git_repos(project_id);
`)
	return err
}

func (s *Store) BareRepoPath(slug string) string {
	return filepath.Join(s.gitRoot, slug+".git")
}

func (s *Store) CreateGitRepo(name, slug, projectID string) (GitRepo, error) {
	name = strings.TrimSpace(name)
	slug = strings.TrimSpace(strings.ToLower(slug))
	if name == "" || !gitSlugRe.MatchString(slug) {
		return GitRepo{}, errors.New("invalid name or slug")
	}
	projectID = strings.TrimSpace(projectID)
	var canonProjID string
	if projectID != "" {
		p, ok, err := s.GetProject(projectID)
		if err != nil || !ok {
			return GitRepo{}, errors.New("project not found")
		}
		canonProjID = p.ID
	}
	bare := s.BareRepoPath(slug)
	if _, err := os.Stat(bare); err == nil {
		return GitRepo{}, errors.New("repository path exists")
	}
	if _, err := git.PlainInit(bare, true); err != nil {
		return GitRepo{}, err
	}
	id := uuid.NewString()
	ts := time.Now().UnixMilli()
	var proj sql.NullString
	if canonProjID != "" {
		proj = sql.NullString{String: canonProjID, Valid: true}
	}
	_, err := s.db.Exec(`INSERT INTO git_repos(id,slug,name,project_id,created_at) VALUES(?,?,?,?,?)`,
		id, slug, name, proj, ts)
	if err != nil {
		_ = os.RemoveAll(bare)
		return GitRepo{}, err
	}
	out := GitRepo{ID: id, Slug: slug, Name: name, CreatedAt: ts}
	if canonProjID != "" {
		out.ProjectID = canonProjID
	}
	return out, nil
}

func (s *Store) ListGitRepos() ([]GitRepo, error) {
	rows, err := s.db.Query(`SELECT id, slug, name, project_id, created_at FROM git_repos ORDER BY created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []GitRepo
	for rows.Next() {
		var g GitRepo
		var proj sql.NullString
		if err := rows.Scan(&g.ID, &g.Slug, &g.Name, &proj, &g.CreatedAt); err != nil {
			return nil, err
		}
		if proj.Valid {
			g.ProjectID = proj.String
		}
		out = append(out, g)
	}
	return out, rows.Err()
}

func (s *Store) GetGitRepo(key string) (GitRepo, bool, error) {
	key = strings.TrimSpace(key)
	var g GitRepo
	var proj sql.NullString
	err := s.db.QueryRow(
		`SELECT id, slug, name, project_id, created_at FROM git_repos WHERE id=? OR slug=? LIMIT 1`,
		key, strings.ToLower(key),
	).Scan(&g.ID, &g.Slug, &g.Name, &proj, &g.CreatedAt)
	if err == sql.ErrNoRows {
		return GitRepo{}, false, nil
	}
	if err != nil {
		return GitRepo{}, false, err
	}
	if proj.Valid {
		g.ProjectID = proj.String
	}
	return g, true, nil
}

func (s *Store) DeleteGitRepo(key string) error {
	g, ok, err := s.GetGitRepo(key)
	if err != nil {
		return err
	}
	if !ok {
		return errors.New("not found")
	}
	bare := s.BareRepoPath(g.Slug)
	if _, err := s.db.Exec(`DELETE FROM git_repos WHERE id=?`, g.ID); err != nil {
		return err
	}
	_ = os.RemoveAll(bare)
	return nil
}
