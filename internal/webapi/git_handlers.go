package webapi

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"
	"unicode"

	"github.com/go-chi/chi/v5"
	"github.com/kirilldma/freedev/internal/gitbrowse"
)

func (a *API) listGitRepos(w http.ResponseWriter, _ *http.Request) {
	list, err := a.st.ListGitRepos()
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, list)
}

type createGitRepoReq struct {
	Name      string `json:"name"`
	Slug      string `json:"slug"`
	ProjectID string `json:"project_id"`
}

func (a *API) createGitRepo(w http.ResponseWriter, r *http.Request) {
	var body createGitRepoReq
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		httpError(w, http.StatusBadRequest, "invalid json")
		return
	}
	g, err := a.st.CreateGitRepo(body.Name, body.Slug, body.ProjectID)
	if err != nil {
		httpError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, g)
}

func (a *API) getGitRepo(w http.ResponseWriter, r *http.Request) {
	key := chi.URLParam(r, "rid")
	g, ok, err := a.st.GetGitRepo(key)
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if !ok {
		httpError(w, http.StatusNotFound, "not found")
		return
	}
	out := map[string]any{
		"id":           g.ID,
		"slug":         g.Slug,
		"name":         g.Name,
		"project_id":   g.ProjectID,
		"created_at":   g.CreatedAt,
		"clone_path":   "/git/" + g.Slug + ".git",
		"browse_ready": repoHasCommits(a.st.BareRepoPath(g.Slug)),
	}
	if g.ProjectID != "" {
		if p, okp, err := a.st.GetProject(g.ProjectID); err == nil && okp {
			out["project_slug"] = p.Slug
		}
	}
	writeJSON(w, http.StatusOK, out)
}

func repoHasCommits(bare string) bool {
	rp, err := gitbrowse.Open(bare)
	if err != nil {
		return false
	}
	_, err = rp.Head()
	return err == nil
}

func (a *API) deleteGitRepo(w http.ResponseWriter, r *http.Request) {
	key := chi.URLParam(r, "rid")
	if err := a.st.DeleteGitRepo(key); err != nil {
		httpError(w, http.StatusNotFound, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (a *API) gitBranches(w http.ResponseWriter, r *http.Request) {
	key := chi.URLParam(r, "rid")
	g, ok, err := a.st.GetGitRepo(key)
	if err != nil || !ok {
		httpError(w, http.StatusNotFound, "not found")
		return
	}
	rp, err := gitbrowse.Open(a.st.BareRepoPath(g.Slug))
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	br, err := gitbrowse.Branches(rp)
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, br)
}

func (a *API) gitCommits(w http.ResponseWriter, r *http.Request) {
	key := chi.URLParam(r, "rid")
	g, ok, err := a.st.GetGitRepo(key)
	if err != nil || !ok {
		httpError(w, http.StatusNotFound, "not found")
		return
	}
	ref := r.URL.Query().Get("ref")
	limit := 50
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			limit = n
		}
	}
	rp, err := gitbrowse.Open(a.st.BareRepoPath(g.Slug))
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	list, err := gitbrowse.Commits(rp, ref, limit)
	if err != nil {
		if errors.Is(err, gitbrowse.ErrEmptyRepo) {
			writeJSON(w, http.StatusOK, []any{})
			return
		}
		httpError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, list)
}

func (a *API) gitTree(w http.ResponseWriter, r *http.Request) {
	key := chi.URLParam(r, "rid")
	g, ok, err := a.st.GetGitRepo(key)
	if err != nil || !ok {
		httpError(w, http.StatusNotFound, "not found")
		return
	}
	ref := r.URL.Query().Get("ref")
	dir := r.URL.Query().Get("path")
	rp, err := gitbrowse.Open(a.st.BareRepoPath(g.Slug))
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	rows, err := gitbrowse.TreeList(rp, ref, dir)
	if err != nil {
		if errors.Is(err, gitbrowse.ErrEmptyRepo) {
			writeJSON(w, http.StatusOK, []gitbrowse.TreeEntry{})
			return
		}
		httpError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, rows)
}

func (a *API) gitRaw(w http.ResponseWriter, r *http.Request) {
	key := chi.URLParam(r, "rid")
	g, ok, err := a.st.GetGitRepo(key)
	if err != nil || !ok {
		httpError(w, http.StatusNotFound, "not found")
		return
	}
	ref := r.URL.Query().Get("ref")
	path := strings.TrimPrefix(r.URL.Query().Get("path"), "/")
	if path == "" {
		httpError(w, http.StatusBadRequest, "path required")
		return
	}
	rp, err := gitbrowse.Open(a.st.BareRepoPath(g.Slug))
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	rc, sz, err := gitbrowse.BlobReader(rp, ref, path)
	if err != nil {
		httpError(w, http.StatusNotFound, err.Error())
		return
	}
	defer rc.Close()
	ext := filepath.Ext(path)
	ct := mime.TypeByExtension(ext)
	if ct == "" {
		ct = "application/octet-stream"
	}
	w.Header().Set("Content-Type", ct)
	fn := sanitizeZipFilename(filepath.Base(path))
	w.Header().Set("Content-Disposition", fmt.Sprintf(`inline; filename="%s"`, fn))
	if sz >= 0 {
		w.Header().Set("Content-Length", strconv.FormatInt(sz, 10))
	}
	_, _ = io.Copy(w, rc)
}

func sanitizeZipFilename(s string) string {
	var b strings.Builder
	for _, r := range s {
		if r <= 31 || strings.ContainsRune(`<>:"/\|?*`, r) {
			b.WriteByte('_')
			continue
		}
		if !unicode.IsPrint(r) {
			b.WriteByte('_')
			continue
		}
		b.WriteRune(r)
	}
	if b.Len() == 0 {
		return "repo"
	}
	return b.String()
}

func (a *API) gitTags(w http.ResponseWriter, r *http.Request) {
	key := chi.URLParam(r, "rid")
	g, ok, err := a.st.GetGitRepo(key)
	if err != nil || !ok {
		httpError(w, http.StatusNotFound, "not found")
		return
	}
	rp, err := gitbrowse.Open(a.st.BareRepoPath(g.Slug))
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	list, err := gitbrowse.Tags(rp)
	if err != nil {
		httpError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, list)
}

func (a *API) gitCompare(w http.ResponseWriter, r *http.Request) {
	key := chi.URLParam(r, "rid")
	g, ok, err := a.st.GetGitRepo(key)
	if err != nil || !ok {
		httpError(w, http.StatusNotFound, "not found")
		return
	}
	base := strings.TrimSpace(r.URL.Query().Get("base"))
	head := strings.TrimSpace(r.URL.Query().Get("head"))
	if base == "" || head == "" {
		httpError(w, http.StatusBadRequest, "base and head required")
		return
	}
	rp, err := gitbrowse.Open(a.st.BareRepoPath(g.Slug))
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	diff, err := gitbrowse.DiffCommits(rp, base, head, 512<<10)
	if err != nil {
		if errors.Is(err, gitbrowse.ErrEmptyRepo) {
			httpError(w, http.StatusBadRequest, "empty repository")
			return
		}
		httpError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"diff": diff})
}

func (a *API) gitArchiveZip(w http.ResponseWriter, r *http.Request) {
	key := chi.URLParam(r, "rid")
	g, ok, err := a.st.GetGitRepo(key)
	if err != nil || !ok {
		httpError(w, http.StatusNotFound, "not found")
		return
	}
	ref := strings.TrimSpace(r.URL.Query().Get("ref"))
	if ref == "" {
		httpError(w, http.StatusBadRequest, "ref required")
		return
	}
	rp, err := gitbrowse.Open(a.st.BareRepoPath(g.Slug))
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if _, err := gitbrowse.TreeList(rp, ref, ""); err != nil {
		if errors.Is(err, gitbrowse.ErrEmptyRepo) {
			httpError(w, http.StatusBadRequest, "empty repository")
			return
		}
		httpError(w, http.StatusBadRequest, err.Error())
		return
	}
	fn := sanitizeZipFilename(g.Slug) + ".zip"
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", "attachment; filename=\""+fn+"\"")
	err = gitbrowse.WriteZip(w, rp, ref, 80<<20)
	if err != nil {
		if errors.Is(err, gitbrowse.ErrZipTooLarge) {
			http.Error(w, "archive too large", http.StatusRequestEntityTooLarge)
			return
		}
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}
}

func (a *API) gitBlobPreview(w http.ResponseWriter, r *http.Request) {
	key := chi.URLParam(r, "rid")
	g, ok, err := a.st.GetGitRepo(key)
	if err != nil || !ok {
		httpError(w, http.StatusNotFound, "not found")
		return
	}
	ref := strings.TrimSpace(r.URL.Query().Get("ref"))
	path := strings.Trim(strings.TrimPrefix(r.URL.Query().Get("path"), "/"), "/")
	if path == "" {
		httpError(w, http.StatusBadRequest, "path required")
		return
	}
	rp, err := gitbrowse.Open(a.st.BareRepoPath(g.Slug))
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	raw, truncated, binary, sz, err := gitbrowse.BlobPreview(rp, ref, path)
	if err != nil {
		httpError(w, http.StatusNotFound, err.Error())
		return
	}
	content := ""
	if !binary {
		content = string(raw)
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"path":      path,
		"ref":       ref,
		"binary":    binary,
		"truncated": truncated,
		"size":      sz,
		"content":   content,
	})
}
