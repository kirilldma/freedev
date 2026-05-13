package store

import (
	"database/sql"
	"path/filepath"
	"time"

	"github.com/google/uuid"
	_ "modernc.org/sqlite"
)

type Store struct {
	db      *sql.DB
	gitRoot string
}

func Open(dir string) (*Store, *sql.DB, error) {
	if err := ensureDir(dir); err != nil {
		return nil, nil, err
	}
	gitRoot := filepath.Join(dir, "git-repos")
	if err := ensureDir(gitRoot); err != nil {
		return nil, nil, err
	}
	path := filepath.Join(dir, "freedev.db")
	db, err := sql.Open("sqlite", path+"?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)&_pragma=synchronous(NORMAL)&_pragma=foreign_keys(ON)")
	if err != nil {
		return nil, nil, err
	}
	db.SetMaxOpenConns(1)
	s := &Store{db: db, gitRoot: gitRoot}
	if err := s.migrate(); err != nil {
		db.Close()
		return nil, nil, err
	}
	return s, db, nil
}

func (s *Store) GitRoot() string {
	return s.gitRoot
}

func (s *Store) migrate() error {
	_, err := s.db.Exec(`
CREATE TABLE IF NOT EXISTS projects (
	id TEXT PRIMARY KEY,
	name TEXT NOT NULL UNIQUE,
	slug TEXT NOT NULL UNIQUE,
	description TEXT DEFAULT '',
	created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS pipelines (
	id TEXT PRIMARY KEY,
	project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
	name TEXT NOT NULL,
	yaml TEXT DEFAULT '',
	created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS builds (
	id TEXT PRIMARY KEY,
	pipeline_id TEXT NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
	status TEXT NOT NULL,
	log_tail TEXT DEFAULT '',
	started_at INTEGER NOT NULL,
	finished_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_pipelines_project ON pipelines(project_id);
CREATE INDEX IF NOT EXISTS idx_builds_pipeline ON builds(pipeline_id);
`)
	if err != nil {
		return err
	}
	if err := s.authMigrate(); err != nil {
		return err
	}
	s.patchSchema()
	if err := s.issueMigrate(); err != nil {
		return err
	}
	return s.gitReposMigrate()
}

type Project struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Slug        string `json:"slug"`
	Description string `json:"description"`
	CreatedAt   int64  `json:"created_at"`
	Archived    int64  `json:"archived"`
}

type Pipeline struct {
	ID        string `json:"id"`
	ProjectID string `json:"project_id"`
	Name      string `json:"name"`
	YAML      string `json:"yaml"`
	CreatedAt int64  `json:"created_at"`
}

type Build struct {
	ID         string `json:"id"`
	PipelineID string `json:"pipeline_id"`
	Status     string `json:"status"`
	LogTail    string `json:"log_tail"`
	StartedAt  int64  `json:"started_at"`
	FinishedAt int64  `json:"finished_at,omitempty"`
}

func (s *Store) ListProjects() ([]Project, error) {
	rows, err := s.db.Query(`SELECT id, name, slug, description, created_at, COALESCE(archived,0) FROM projects ORDER BY created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Project
	for rows.Next() {
		var p Project
		if err := rows.Scan(&p.ID, &p.Name, &p.Slug, &p.Description, &p.CreatedAt, &p.Archived); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func (s *Store) CreateProject(name, slug, description string) (Project, error) {
	id := uuid.NewString()
	ts := time.Now().UnixMilli()
	_, err := s.db.Exec(`INSERT INTO projects(id,name,slug,description,created_at,archived) VALUES(?,?,?,?,?,0)`, id, name, slug, description, ts)
	if err != nil {
		return Project{}, err
	}
	return Project{ID: id, Name: name, Slug: slug, Description: description, CreatedAt: ts, Archived: 0}, nil
}

func (s *Store) GetProject(id string) (Project, bool, error) {
	var p Project
	err := s.db.QueryRow(`SELECT id,name,slug,description,created_at,COALESCE(archived,0) FROM projects WHERE id=? OR slug=? LIMIT 1`, id, id).
		Scan(&p.ID, &p.Name, &p.Slug, &p.Description, &p.CreatedAt, &p.Archived)
	if err == sql.ErrNoRows {
		return Project{}, false, nil
	}
	if err != nil {
		return Project{}, false, err
	}
	return p, true, nil
}

func (s *Store) ListPipelines(projectID string) ([]Pipeline, error) {
	rows, err := s.db.Query(`SELECT id, project_id, name, yaml, created_at FROM pipelines WHERE project_id=? ORDER BY created_at DESC`, projectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Pipeline
	for rows.Next() {
		var p Pipeline
		if err := rows.Scan(&p.ID, &p.ProjectID, &p.Name, &p.YAML, &p.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func (s *Store) CreatePipeline(projectID, name, yaml string) (Pipeline, error) {
	id := uuid.NewString()
	ts := time.Now().UnixMilli()
	_, err := s.db.Exec(`INSERT INTO pipelines(id,project_id,name,yaml,created_at) VALUES(?,?,?,?,?)`, id, projectID, name, yaml, ts)
	if err != nil {
		return Pipeline{}, err
	}
	return Pipeline{ID: id, ProjectID: projectID, Name: name, YAML: yaml, CreatedAt: ts}, nil
}

func (s *Store) ListBuilds(pipelineID string, limit int) ([]Build, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	rows, err := s.db.Query(`SELECT id,pipeline_id,status,log_tail,started_at,finished_at FROM builds WHERE pipeline_id=? ORDER BY started_at DESC LIMIT ?`, pipelineID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Build
	for rows.Next() {
		var b Build
		var fin sql.NullInt64
		if err := rows.Scan(&b.ID, &b.PipelineID, &b.Status, &b.LogTail, &b.StartedAt, &fin); err != nil {
			return nil, err
		}
		if fin.Valid {
			b.FinishedAt = fin.Int64
		}
		out = append(out, b)
	}
	return out, rows.Err()
}

func (s *Store) CreateBuild(pipelineID, status, logTail string) (Build, error) {
	id := uuid.NewString()
	ts := time.Now().UnixMilli()
	_, err := s.db.Exec(`INSERT INTO builds(id,pipeline_id,status,log_tail,started_at,finished_at) VALUES(?,?,?,?,?,NULL)`, id, pipelineID, status, logTail, ts)
	if err != nil {
		return Build{}, err
	}
	return Build{ID: id, PipelineID: pipelineID, Status: status, LogTail: logTail, StartedAt: ts}, nil
}

type Overview struct {
	Projects    int64 `json:"projects"`
	Pipelines   int64 `json:"pipelines"`
	Builds      int64 `json:"builds"`
	IssuesTotal int64 `json:"issues_total"`
	GitRepos    int64 `json:"git_repos"`
	Running     int64 `json:"builds_running"`
	Queued      int64 `json:"builds_queued"`
	Passed      int64 `json:"builds_passed"`
	Failed      int64 `json:"builds_failed"`
}

func (s *Store) Overview() (Overview, error) {
	var o Overview
	err := s.db.QueryRow(`
SELECT
	(SELECT COUNT(*) FROM projects),
	(SELECT COUNT(*) FROM pipelines),
	(SELECT COUNT(*) FROM builds),
	(SELECT COUNT(*) FROM issues),
	(SELECT COUNT(*) FROM git_repos),
	(SELECT COUNT(*) FROM builds WHERE lower(trim(status)) IN ('running','run')),
	(SELECT COUNT(*) FROM builds WHERE lower(trim(status))='queued'),
	(SELECT COUNT(*) FROM builds WHERE lower(trim(status)) IN ('passed','pass','ok','done','success')),
	(SELECT COUNT(*) FROM builds WHERE lower(trim(status)) IN ('failed','fail','error'))
`).Scan(&o.Projects, &o.Pipelines, &o.Builds, &o.IssuesTotal, &o.GitRepos, &o.Running, &o.Queued, &o.Passed, &o.Failed)
	return o, err
}

type FeedRow struct {
	Build        Build  `json:"build"`
	PipelineID   string `json:"pipeline_id"`
	PipelineName string `json:"pipeline_name"`
	ProjectID    string `json:"project_id"`
	ProjectSlug  string `json:"project_slug"`
	ProjectName  string `json:"project_name"`
}

func (s *Store) Feed(limit int) ([]FeedRow, error) {
	if limit <= 0 || limit > 100 {
		limit = 30
	}
	rows, err := s.db.Query(`
SELECT b.id, b.pipeline_id, b.status, b.log_tail, b.started_at, b.finished_at,
	p.id, p.name, pr.id, pr.slug, pr.name
FROM builds b
JOIN pipelines p ON p.id = b.pipeline_id
JOIN projects pr ON pr.id = p.project_id
ORDER BY b.started_at DESC
LIMIT ?
`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []FeedRow
	for rows.Next() {
		var r FeedRow
		var fin sql.NullInt64
		if err := rows.Scan(
			&r.Build.ID, &r.Build.PipelineID, &r.Build.Status, &r.Build.LogTail, &r.Build.StartedAt, &fin,
			&r.PipelineID, &r.PipelineName, &r.ProjectID, &r.ProjectSlug, &r.ProjectName,
		); err != nil {
			return nil, err
		}
		if fin.Valid {
			r.Build.FinishedAt = fin.Int64
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

type PipelineDetail struct {
	Pipeline
	ProjectSlug string `json:"project_slug"`
	ProjectName string `json:"project_name"`
}

func (s *Store) PipelineDetail(pid string) (PipelineDetail, bool, error) {
	var d PipelineDetail
	err := s.db.QueryRow(`
SELECT pl.id, pl.project_id, pl.name, pl.yaml, pl.created_at, pr.slug, pr.name
FROM pipelines pl
JOIN projects pr ON pr.id = pl.project_id
WHERE pl.id = ?
LIMIT 1
`, pid).Scan(
		&d.ID, &d.ProjectID, &d.Name, &d.YAML, &d.CreatedAt,
		&d.ProjectSlug, &d.ProjectName,
	)
	if err == sql.ErrNoRows {
		return PipelineDetail{}, false, nil
	}
	if err != nil {
		return PipelineDetail{}, false, err
	}
	return d, true, nil
}
