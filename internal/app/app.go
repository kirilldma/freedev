package app

import (
	"database/sql"
	"embed"
	"io/fs"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/kirilldma/freedev/internal/githttp"
	"github.com/kirilldma/freedev/internal/store"
	"github.com/kirilldma/freedev/internal/webapi"
)

//go:embed all:static
var staticFS embed.FS

type App struct {
	db *sql.DB
	st *store.Store
}

func New(dataDir string) (*App, error) {
	st, db, err := store.Open(dataDir)
	if err != nil {
		return nil, err
	}
	return &App{db: db, st: st}, nil
}

func (a *App) Close() error {
	return a.db.Close()
}

func (a *App) Handler() http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Recoverer)

	gitH := http.Handler(githttp.SmartHandler(a.st))
	if n, err := a.st.CountUsers(); err == nil && n > 0 {
		gitH = githttp.WithBasicAuth(a.st, gitH)
	}
	r.Handle("/git/*", gitH)

	apiR := chi.NewRouter()
	apiR.Use(middleware.Compress(5))
	apiR.Mount("/", webapi.New(a.st).Routes())

	r.Mount("/api", apiR)

	sub, err := fs.Sub(staticFS, "static")
	if err != nil {
		panic(err)
	}
	fsrv := http.FileServer(http.FS(sub))
	r.NotFound(fsrv.ServeHTTP)
	r.MethodNotAllowed(fsrv.ServeHTTP)
	return r
}
