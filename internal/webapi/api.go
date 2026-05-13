package webapi

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/kirilldma/freedev/internal/store"
)

type API struct {
	st *store.Store
}

func New(st *store.Store) *API {
	return &API{st: st}
}

func (a *API) Routes() http.Handler {
	r := chi.NewRouter()
	r.Get("/health", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	})
	r.Get("/meta", a.metaPublic)
	r.Post("/auth/login", a.login)
	r.Post("/auth/logout", a.logout)
	r.Post("/auth/register", a.register)
	r.Post("/auth/bootstrap", a.bootstrap)

	r.Group(func(r chi.Router) {
		r.Use(a.RequireAuth)
		r.Get("/auth/me", a.me)
		r.Route("/admin", func(r chi.Router) {
			r.Use(a.RequireAdmin)
			r.Get("/settings", a.adminGetSettings)
			r.Patch("/settings", a.adminPatchSettings)
			r.Get("/users", a.adminListUsers)
			r.Post("/users", a.adminCreateUser)
			r.Delete("/users/{uid}", a.adminDeleteUser)
		})

		r.Get("/overview", a.overview)
		r.Get("/feed", a.feed)
		r.Get("/search", a.search)
		r.Route("/issues/{iid}", func(r chi.Router) {
			r.Get("/", a.getIssue)
			r.Patch("/", a.patchIssue)
			r.Delete("/", a.deleteIssue)
		})
		r.Route("/git/repos", func(r chi.Router) {
			r.Get("/", a.listGitRepos)
			r.Post("/", a.createGitRepo)
			r.Route("/{rid}", func(r chi.Router) {
				r.Get("/", a.getGitRepo)
				r.Delete("/", a.deleteGitRepo)
				r.Get("/branches", a.gitBranches)
				r.Get("/commits", a.gitCommits)
				r.Get("/tags", a.gitTags)
				r.Get("/compare", a.gitCompare)
				r.Get("/archive.zip", a.gitArchiveZip)
				r.Get("/blob-content", a.gitBlobPreview)
				r.Get("/tree", a.gitTree)
				r.Get("/raw", a.gitRaw)
				r.Post("/upload", a.gitUpload)
				r.Post("/delete-path", a.gitDeletePath)
			})
		})
		r.Get("/projects", a.listProjects)
		r.Post("/projects", a.createProject)
		r.Route("/projects/{id}", func(r chi.Router) {
			r.Get("/", a.getProject)
			r.Patch("/", a.patchProject)
			r.Get("/export", a.exportProject)
			r.Get("/pipelines", a.listPipelines)
			r.Post("/pipelines", a.createPipeline)
			r.Get("/issues", a.listIssuesForProject)
			r.Post("/issues", a.createIssueForProject)
		})
		r.Route("/pipelines/{pid}", func(r chi.Router) {
			r.Get("/builds", a.listBuilds)
			r.Post("/builds", a.createBuild)
			r.Get("/", a.getPipeline)
			r.Delete("/", a.deletePipeline)
		})
	})
	return r
}

func (a *API) overview(w http.ResponseWriter, _ *http.Request) {
	o, err := a.st.Overview()
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, o)
}

func (a *API) feed(w http.ResponseWriter, r *http.Request) {
	n := 30
	if q := r.URL.Query().Get("limit"); q != "" {
		if v, err := strconv.Atoi(q); err == nil {
			n = v
		}
	}
	rows, err := a.st.Feed(n)
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, rows)
}

func (a *API) getPipeline(w http.ResponseWriter, r *http.Request) {
	pid := chi.URLParam(r, "pid")
	d, ok, err := a.st.PipelineDetail(pid)
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if !ok {
		httpError(w, http.StatusNotFound, "pipeline not found")
		return
	}
	writeJSON(w, http.StatusOK, d)
}

func (a *API) listProjects(w http.ResponseWriter, r *http.Request) {
	list, err := a.st.ListProjects()
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, list)
}

type createProjectReq struct {
	Name        string `json:"name"`
	Slug        string `json:"slug"`
	Description string `json:"description"`
}

func (a *API) createProject(w http.ResponseWriter, r *http.Request) {
	var body createProjectReq
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		httpError(w, http.StatusBadRequest, "invalid json")
		return
	}
	body.Name = strings.TrimSpace(body.Name)
	body.Slug = strings.TrimSpace(strings.ToLower(body.Slug))
	if body.Name == "" || body.Slug == "" {
		httpError(w, http.StatusBadRequest, "name and slug required")
		return
	}
	p, err := a.st.CreateProject(body.Name, body.Slug, body.Description)
	if err != nil {
		httpError(w, http.StatusConflict, "create failed")
		return
	}
	writeJSON(w, http.StatusCreated, p)
}

func (a *API) getProject(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	p, ok, err := a.st.GetProject(id)
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

func (a *API) listPipelines(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	p, ok, err := a.st.GetProject(id)
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if !ok {
		httpError(w, http.StatusNotFound, "project not found")
		return
	}
	list, err := a.st.ListPipelines(p.ID)
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, list)
}

type createPipelineReq struct {
	Name string `json:"name"`
	YAML string `json:"yaml"`
}

func (a *API) createPipeline(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	p, ok, err := a.st.GetProject(id)
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if !ok {
		httpError(w, http.StatusNotFound, "project not found")
		return
	}
	var body createPipelineReq
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		httpError(w, http.StatusBadRequest, "invalid json")
		return
	}
	body.Name = strings.TrimSpace(body.Name)
	if body.Name == "" {
		httpError(w, http.StatusBadRequest, "name required")
		return
	}
	pl, err := a.st.CreatePipeline(p.ID, body.Name, body.YAML)
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, pl)
}

func (a *API) listBuilds(w http.ResponseWriter, r *http.Request) {
	pid := chi.URLParam(r, "pid")
	n := 80
	if q := r.URL.Query().Get("limit"); q != "" {
		if x, err := strconv.Atoi(q); err == nil && x > 0 && x <= 500 {
			n = x
		}
	}
	list, err := a.st.ListBuilds(pid, n)
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, list)
}

type createBuildReq struct {
	Status  string `json:"status"`
	LogTail string `json:"log_tail"`
}

func (a *API) createBuild(w http.ResponseWriter, r *http.Request) {
	pid := chi.URLParam(r, "pid")
	var body createBuildReq
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		httpError(w, http.StatusBadRequest, "invalid json")
		return
	}
	body.Status = strings.TrimSpace(body.Status)
	if body.Status == "" {
		body.Status = "queued"
	}
	b, err := a.st.CreateBuild(pid, body.Status, body.LogTail)
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, b)
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func httpError(w http.ResponseWriter, code int, msg string) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": msg})
}
