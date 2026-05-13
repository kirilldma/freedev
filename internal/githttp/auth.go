package githttp

import (
	"net/http"

	"github.com/kirilldma/freedev/internal/store"
)

func WithBasicAuth(st *store.Store, inner http.Handler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, pass, ok := r.BasicAuth()
		if !ok {
			w.Header().Set("WWW-Authenticate", `Basic realm="FreeDev Git"`)
			http.Error(w, "authentication required", http.StatusUnauthorized)
			return
		}
		u, err := st.UserByCredentials(user, pass)
		if err != nil || u == nil {
			http.Error(w, "invalid credentials", http.StatusUnauthorized)
			return
		}
		inner.ServeHTTP(w, r)
	}
}
