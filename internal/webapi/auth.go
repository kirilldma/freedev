package webapi

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/kirilldma/freedev/internal/store"
)

type authCtxKey struct{}

func withUser(r *http.Request, u *store.User) *http.Request {
	return r.WithContext(context.WithValue(r.Context(), authCtxKey{}, u))
}

func userFrom(r *http.Request) (*store.User, bool) {
	u, ok := r.Context().Value(authCtxKey{}).(*store.User)
	return u, ok
}

const sessionCookie = "fd_sess"
const sessionTTL = 30 * 24 * time.Hour

func readCookie(r *http.Request, name string) string {
	c, err := r.Cookie(name)
	if err != nil {
		return ""
	}
	return c.Value
}

func writeSessionCookie(w http.ResponseWriter, token string, maxAgeSec int) {
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookie,
		Value:    token,
		Path:     "/",
		MaxAge:   maxAgeSec,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
	})
}

func clearSessionCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookie,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
	})
}

func sessionUser(a *API, r *http.Request) (*store.User, bool, error) {
	tok := readCookie(r, sessionCookie)
	if tok == "" {
		return nil, false, nil
	}
	return a.st.UserBySessionToken(tok)
}

func (a *API) metaPublic(w http.ResponseWriter, r *http.Request) {
	n, err := a.st.CountUsers()
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	ss, err := a.st.GetSiteSettings()
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	codeOn, err := a.st.AccessCodeActive()
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	authRequired := n > 0
	var sess any
	u, ok, err := sessionUser(a, r)
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if ok && u != nil {
		sess = map[string]string{"username": u.Username, "role": u.Role}
	} else {
		sess = nil
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"name":                "freedev",
		"version":             "0.4.0",
		"runtime":             "go",
		"product_name":        ss.ProductName,
		"product_tagline":     ss.ProductTagline,
		"logo_url":            ss.LogoURL,
		"accent_hex":          ss.AccentHex,
		"registration_open":   ss.RegistrationOpen,
		"access_code_required": codeOn && ss.RegistrationOpen,
		"auth_required":       authRequired,
		"bootstrap_needed":    n == 0,
		"session":             sess,
	})
}

func (a *API) RequireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		u, ok, err := sessionUser(a, r)
		if err != nil {
			httpError(w, http.StatusInternalServerError, err.Error())
			return
		}
		if !ok || u == nil {
			httpError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		next.ServeHTTP(w, withUser(r, u))
	})
}

func (a *API) RequireAdmin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		u, ok := userFrom(r)
		if !ok || u == nil || u.Role != "admin" {
			httpError(w, http.StatusForbidden, "admin only")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (a *API) me(w http.ResponseWriter, r *http.Request) {
	u, ok := userFrom(r)
	if !ok || u == nil {
		httpError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	writeJSON(w, http.StatusOK, u)
}

type loginReq struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

func (a *API) login(w http.ResponseWriter, r *http.Request) {
	var body loginReq
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		httpError(w, http.StatusBadRequest, "invalid json")
		return
	}
	u, err := a.st.UserByCredentials(body.Username, body.Password)
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if u == nil {
		httpError(w, http.StatusUnauthorized, "bad credentials")
		return
	}
	token, err := a.st.CreateSession(u.ID, sessionTTL)
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeSessionCookie(w, token, int(sessionTTL.Seconds()))
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "user": map[string]string{"username": u.Username, "role": u.Role}})
}

func (a *API) logout(w http.ResponseWriter, r *http.Request) {
	tok := readCookie(r, sessionCookie)
	if tok != "" {
		_ = a.st.DeleteSession(tok)
	}
	clearSessionCookie(w)
	w.WriteHeader(http.StatusNoContent)
}

func (a *API) bootstrap(w http.ResponseWriter, r *http.Request) {
	n, err := a.st.CountUsers()
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if n > 0 {
		httpError(w, http.StatusForbidden, "already initialized")
		return
	}
	var body struct {
		Username string `json:"username"`
		Password string `json:"password"`
		Code     string `json:"access_code"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		httpError(w, http.StatusBadRequest, "invalid json")
		return
	}
	if env := strings.TrimSpace(os.Getenv("FREEDEV_BOOTSTRAP_CODE")); env != "" && strings.TrimSpace(body.Code) != env {
		httpError(w, http.StatusForbidden, "bootstrap code mismatch")
		return
	}
	u, err := a.st.CreateUser(body.Username, body.Password, "admin")
	if err != nil {
		httpError(w, http.StatusBadRequest, err.Error())
		return
	}
	token, err := a.st.CreateSession(u.ID, sessionTTL)
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeSessionCookie(w, token, int(sessionTTL.Seconds()))
	writeJSON(w, http.StatusCreated, map[string]any{"ok": true, "user": map[string]string{"username": u.Username, "role": u.Role}})
}

func (a *API) register(w http.ResponseWriter, r *http.Request) {
	n, err := a.st.CountUsers()
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if n == 0 {
		httpError(w, http.StatusBadRequest, "use bootstrap")
		return
	}
	open, err := a.st.RegistrationAllowed()
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if !open {
		httpError(w, http.StatusForbidden, "registration closed")
		return
	}
	var body struct {
		Username string `json:"username"`
		Password string `json:"password"`
		Code     string `json:"access_code"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		httpError(w, http.StatusBadRequest, "invalid json")
		return
	}
	okCode, err := a.st.VerifyAccessCode(body.Code)
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if !okCode {
		httpError(w, http.StatusForbidden, "bad access code")
		return
	}
	u, err := a.st.CreateUser(body.Username, body.Password, "user")
	if err != nil {
		httpError(w, http.StatusConflict, err.Error())
		return
	}
	token, err := a.st.CreateSession(u.ID, sessionTTL)
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeSessionCookie(w, token, int(sessionTTL.Seconds()))
	writeJSON(w, http.StatusCreated, map[string]any{"ok": true, "user": map[string]string{"username": u.Username, "role": u.Role}})
}
