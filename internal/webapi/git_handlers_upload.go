package webapi

import (
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/kirilldma/freedev/internal/gitwork"
)

func (a *API) gitUpload(w http.ResponseWriter, r *http.Request) {
	rid := chi.URLParam(r, "rid")
	g, ok, err := a.st.GetGitRepo(rid)
	if err != nil || !ok {
		httpError(w, http.StatusNotFound, "not found")
		return
	}
	if !gitwork.HasGit() {
		httpError(w, http.StatusServiceUnavailable, gitwork.ErrNoGit.Error())
		return
	}
	bare := a.st.BareRepoPath(g.Slug)

	ct := r.Header.Get("Content-Type")
	if strings.HasPrefix(ct, "application/json") {
		var body struct {
			Path          string `json:"path"`
			Branch        string `json:"branch"`
			Message       string `json:"message"`
			ContentBase64 string `json:"content_base64"`
		}
		if err := json.NewDecoder(io.LimitReader(r.Body, 64<<20)).Decode(&body); err != nil {
			httpError(w, http.StatusBadRequest, "invalid json")
			return
		}
		raw, err := base64.StdEncoding.DecodeString(body.ContentBase64)
		if err != nil {
			httpError(w, http.StatusBadRequest, "bad base64")
			return
		}
		p := strings.TrimSpace(body.Path)
		if p == "" {
			httpError(w, http.StatusBadRequest, "path required")
			return
		}
		if err := gitwork.CommitAdd(r.Context(), bare, strings.TrimSpace(body.Branch), p, raw, body.Message); err != nil {
			httpError(w, http.StatusBadRequest, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
		return
	}

	if err := r.ParseMultipartForm(48 << 20); err != nil {
		httpError(w, http.StatusBadRequest, "multipart parse failed")
		return
	}
	pathVal := strings.TrimSpace(r.FormValue("path"))
	branch := strings.TrimSpace(r.FormValue("branch"))
	msg := strings.TrimSpace(r.FormValue("message"))
	f, hdr, err := r.FormFile("file")
	if err != nil {
		httpError(w, http.StatusBadRequest, "file required")
		return
	}
	defer f.Close()
	data, err := io.ReadAll(io.LimitReader(f, 48<<20))
	if err != nil {
		httpError(w, http.StatusBadRequest, "read body")
		return
	}
	if pathVal == "" {
		pathVal = hdr.Filename
	}
	pathVal = strings.TrimSpace(pathVal)
	if pathVal == "" {
		httpError(w, http.StatusBadRequest, "path required")
		return
	}
	if err := gitwork.CommitAdd(r.Context(), bare, branch, pathVal, data, msg); err != nil {
		httpError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (a *API) gitDeletePath(w http.ResponseWriter, r *http.Request) {
	rid := chi.URLParam(r, "rid")
	g, ok, err := a.st.GetGitRepo(rid)
	if err != nil || !ok {
		httpError(w, http.StatusNotFound, "not found")
		return
	}
	if !gitwork.HasGit() {
		httpError(w, http.StatusServiceUnavailable, gitwork.ErrNoGit.Error())
		return
	}
	var body struct {
		Path       string `json:"path"`
		Branch     string `json:"branch"`
		Message    string `json:"message"`
		Recursive  bool   `json:"recursive"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&body); err != nil {
		httpError(w, http.StatusBadRequest, "invalid json")
		return
	}
	p := strings.TrimSpace(body.Path)
	if p == "" {
		httpError(w, http.StatusBadRequest, "path required")
		return
	}
	bare := a.st.BareRepoPath(g.Slug)
	if err := gitwork.CommitRemove(r.Context(), bare, strings.TrimSpace(body.Branch), p, body.Message, body.Recursive); err != nil {
		httpError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}
