package webapi

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
)

func (a *API) search(w http.ResponseWriter, r *http.Request) {
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	n := 40
	if v := r.URL.Query().Get("limit"); v != "" {
		if x, err := strconv.Atoi(v); err == nil {
			n = x
		}
	}
	out, err := a.st.Search(q, n)
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, out)
}

func (a *API) exportProject(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	bundle, ok, err := a.st.ExportProject(id)
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if !ok {
		httpError(w, http.StatusNotFound, "project not found")
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="export-`+bundle.Project.Slug+`.json"`)
	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	_ = enc.Encode(bundle)
}

func (a *API) patchProject(w http.ResponseWriter, r *http.Request) {
	key := chi.URLParam(r, "id")
	var body struct {
		Archived    *bool   `json:"archived"`
		Description *string `json:"description"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		httpError(w, http.StatusBadRequest, "invalid json")
		return
	}
	p, ok, err := a.st.PatchProject(key, body.Archived, body.Description)
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if !ok {
		httpError(w, http.StatusNotFound, "not found")
		return
	}
	writeJSON(w, http.StatusOK, p)
}

func (a *API) deletePipeline(w http.ResponseWriter, r *http.Request) {
	pid := chi.URLParam(r, "pid")
	_, ok, err := a.st.PipelineDetail(pid)
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if !ok {
		httpError(w, http.StatusNotFound, "pipeline not found")
		return
	}
	if err := a.st.DeletePipeline(pid); err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (a *API) listIssuesForProject(w http.ResponseWriter, r *http.Request) {
	key := chi.URLParam(r, "id")
	p, ok, err := a.st.GetProject(key)
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if !ok {
		httpError(w, http.StatusNotFound, "project not found")
		return
	}
	n := 120
	if v := r.URL.Query().Get("limit"); v != "" {
		if x, err := strconv.Atoi(v); err == nil {
			n = x
		}
	}
	list, err := a.st.ListIssues(p.ID, n)
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, list)
}

func (a *API) createIssueForProject(w http.ResponseWriter, r *http.Request) {
	key := chi.URLParam(r, "id")
	p, ok, err := a.st.GetProject(key)
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if !ok {
		httpError(w, http.StatusNotFound, "project not found")
		return
	}
	var body struct {
		Title    string `json:"title"`
		Body     string `json:"body"`
		Priority int    `json:"priority"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		httpError(w, http.StatusBadRequest, "invalid json")
		return
	}
	x, err := a.st.CreateIssue(p.ID, body.Title, body.Body, body.Priority)
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "title") {
			httpError(w, http.StatusBadRequest, err.Error())
			return
		}
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, x)
}

func (a *API) getIssue(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "iid")
	x, ok, err := a.st.GetIssue(id)
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if !ok {
		httpError(w, http.StatusNotFound, "issue not found")
		return
	}
	writeJSON(w, http.StatusOK, x)
}

func (a *API) patchIssue(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "iid")
	var body struct {
		Title    *string `json:"title"`
		Body     *string `json:"body"`
		Status   *string `json:"status"`
		Priority *int    `json:"priority"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		httpError(w, http.StatusBadRequest, "invalid json")
		return
	}
	x, ok, err := a.st.UpdateIssue(id, body.Title, body.Body, body.Status, body.Priority)
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if !ok {
		httpError(w, http.StatusNotFound, "issue not found")
		return
	}
	writeJSON(w, http.StatusOK, x)
}

func (a *API) deleteIssue(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "iid")
	x, ok, err := a.st.GetIssue(id)
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if !ok {
		httpError(w, http.StatusNotFound, "issue not found")
		return
	}
	if err := a.st.DeleteIssue(x.ID); err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
