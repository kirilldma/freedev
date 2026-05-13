package store

import (
	"strings"
	"time"
)

type SearchHitProject struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Slug     string `json:"slug"`
	Archived bool   `json:"archived"`
}

type SearchHitIssue struct {
	ID           string `json:"id"`
	Title        string `json:"title"`
	Status       string `json:"status"`
	ProjectID    string `json:"project_id"`
	ProjectSlug  string `json:"project_slug"`
	ProjectName  string `json:"project_name"`
	Priority     int    `json:"priority"`
}

type SearchResult struct {
	Query    string             `json:"query"`
	Projects []SearchHitProject `json:"projects"`
	Issues   []SearchHitIssue   `json:"issues"`
}

func (s *Store) Search(raw string, limit int) (SearchResult, error) {
	raw = strings.TrimSpace(raw)
	if limit <= 0 || limit > 80 {
		limit = 40
	}
	out := SearchResult{Query: raw, Projects: nil, Issues: nil}
	if raw == "" {
		return out, nil
	}
	q := "%" + strings.ToLower(raw) + "%"
	prows, err := s.db.Query(`
SELECT id, name, slug, COALESCE(archived,0) FROM projects
WHERE lower(name) LIKE ? OR lower(slug) LIKE ? OR lower(description) LIKE ?
ORDER BY created_at DESC LIMIT ?
`, q, q, q, limit)
	if err != nil {
		return out, err
	}
	defer prows.Close()
	for prows.Next() {
		var p SearchHitProject
		var ar int64
		if err := prows.Scan(&p.ID, &p.Name, &p.Slug, &ar); err != nil {
			return out, err
		}
		p.Archived = ar != 0
		out.Projects = append(out.Projects, p)
	}
	if err := prows.Err(); err != nil {
		return out, err
	}

	irows, err := s.db.Query(`
SELECT i.id, i.title, i.status, i.priority, pr.id, pr.slug, pr.name
FROM issues i
JOIN projects pr ON pr.id = i.project_id
WHERE lower(i.title) LIKE ? OR lower(i.body) LIKE ?
ORDER BY i.updated_at DESC LIMIT ?
`, q, q, limit)
	if err != nil {
		return out, err
	}
	defer irows.Close()
	for irows.Next() {
		var h SearchHitIssue
		if err := irows.Scan(&h.ID, &h.Title, &h.Status, &h.Priority, &h.ProjectID, &h.ProjectSlug, &h.ProjectName); err != nil {
			return out, err
		}
		out.Issues = append(out.Issues, h)
	}
	return out, irows.Err()
}

type ExportBundle struct {
	Project    Project    `json:"project"`
	Pipelines  []Pipeline `json:"pipelines"`
	Issues     []Issue    `json:"issues"`
	BuildIDs   []string   `json:"build_sample_ids"`
	ExportedAt int64      `json:"exported_at"`
}

func (s *Store) ExportProject(projectID string) (ExportBundle, bool, error) {
	p, ok, err := s.GetProject(projectID)
	if err != nil || !ok {
		return ExportBundle{}, ok, err
	}
	pl, err := s.ListPipelines(p.ID)
	if err != nil {
		return ExportBundle{}, false, err
	}
	is, err := s.ListIssues(p.ID, 500)
	if err != nil {
		return ExportBundle{}, false, err
	}
	var bids []string
	if len(pl) > 0 {
		bs, err := s.ListBuilds(pl[0].ID, 20)
		if err != nil {
			return ExportBundle{}, false, err
		}
		for _, b := range bs {
			bids = append(bids, b.ID)
		}
	}
	return ExportBundle{
		Project:    p,
		Pipelines:  pl,
		Issues:     is,
		BuildIDs:   bids,
		ExportedAt: time.Now().UnixMilli(),
	}, true, nil
}
