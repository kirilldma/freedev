package webapi

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
)

func (a *API) adminGetSettings(w http.ResponseWriter, r *http.Request) {
	ss, err := a.st.GetSiteSettings()
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	active, err := a.st.AccessCodeActive()
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"product_name":         ss.ProductName,
		"product_tagline":      ss.ProductTagline,
		"logo_url":             ss.LogoURL,
		"accent_hex":           ss.AccentHex,
		"registration_open":    ss.RegistrationOpen,
		"access_code_active": active,
		"updated_at":           ss.UpdatedAt,
	})
}

func (a *API) adminPatchSettings(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ProductName       *string `json:"product_name"`
		ProductTagline    *string `json:"product_tagline"`
		LogoURL           *string `json:"logo_url"`
		AccentHex         *string `json:"accent_hex"`
		RegistrationOpen  *bool   `json:"registration_open"`
		AccessCode        *string `json:"access_code"`
		ClearAccessCode   bool    `json:"clear_access_code"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		httpError(w, http.StatusBadRequest, "invalid json")
		return
	}
	if body.AccessCode != nil {
		v := strings.TrimSpace(*body.AccessCode)
		body.AccessCode = &v
		if v == "" {
			body.AccessCode = nil
		}
	}
	if err := a.st.PatchSiteSettings(body.ProductName, body.ProductTagline, body.LogoURL, body.AccentHex, body.RegistrationOpen, body.AccessCode, body.ClearAccessCode); err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	a.adminGetSettings(w, r)
}

func (a *API) adminListUsers(w http.ResponseWriter, r *http.Request) {
	list, err := a.st.ListUsers()
	if err != nil {
		httpError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, list)
}

func (a *API) adminCreateUser(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Username string `json:"username"`
		Password string `json:"password"`
		Role     string `json:"role"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		httpError(w, http.StatusBadRequest, "invalid json")
		return
	}
	if body.Role != "admin" && body.Role != "user" {
		body.Role = "user"
	}
	u, err := a.st.CreateUser(body.Username, body.Password, body.Role)
	if err != nil {
		httpError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, u)
}

func (a *API) adminDeleteUser(w http.ResponseWriter, r *http.Request) {
	actor, ok := userFrom(r)
	if !ok || actor == nil {
		httpError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	target := chi.URLParam(r, "uid")
	if err := a.st.DeleteUser(target, actor.ID); err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "not found") {
			httpError(w, http.StatusNotFound, err.Error())
			return
		}
		httpError(w, http.StatusBadRequest, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
