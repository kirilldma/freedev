package store

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
)

type SiteSettings struct {
	ProductName      string `json:"product_name"`
	ProductTagline   string `json:"product_tagline"`
	LogoURL          string `json:"logo_url"`
	AccentHex        string `json:"accent_hex"`
	RegistrationOpen bool   `json:"registration_open"`
	UpdatedAt        int64  `json:"updated_at"`
}

type User struct {
	ID        string `json:"id"`
	Username  string `json:"username"`
	Role      string `json:"role"`
	CreatedAt int64  `json:"created_at"`
}

func (s *Store) authMigrate() error {
	if _, err := s.db.Exec(`
CREATE TABLE IF NOT EXISTS site_settings (
	id INTEGER PRIMARY KEY CHECK (id = 1),
	product_name TEXT NOT NULL DEFAULT 'FreeDev',
	product_tagline TEXT NOT NULL DEFAULT '',
	logo_url TEXT NOT NULL DEFAULT '',
	accent_hex TEXT NOT NULL DEFAULT '#171717',
	registration_open INTEGER NOT NULL DEFAULT 0,
	access_code_hash TEXT NOT NULL DEFAULT '',
	updated_at INTEGER NOT NULL
);`); err != nil {
		return err
	}
	ts := time.Now().UnixMilli()
	if _, err := s.db.Exec(`INSERT OR IGNORE INTO site_settings(id, product_name, updated_at) VALUES (1, 'FreeDev', ?)`, ts); err != nil {
		return err
	}
	if _, err := s.db.Exec(`
CREATE TABLE IF NOT EXISTS users (
	id TEXT PRIMARY KEY,
	username TEXT NOT NULL UNIQUE COLLATE NOCASE,
	password_hash TEXT NOT NULL,
	role TEXT NOT NULL DEFAULT 'user',
	created_at INTEGER NOT NULL
);`); err != nil {
		return err
	}
	if _, err := s.db.Exec(`
CREATE TABLE IF NOT EXISTS sessions (
	token TEXT PRIMARY KEY,
	user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	expires_at INTEGER NOT NULL
);`); err != nil {
		return err
	}
	_, _ = s.db.Exec(`CREATE INDEX IF NOT EXISTS idx_sessions_exp ON sessions(expires_at)`)
	_, _ = s.db.Exec(`CREATE INDEX IF NOT EXISTS idx_sessions_uid ON sessions(user_id)`)
	return nil
}

func (s *Store) CountUsers() (int64, error) {
	var n int64
	err := s.db.QueryRow(`SELECT COUNT(*) FROM users`).Scan(&n)
	return n, err
}

func (s *Store) AdminCount() (int64, error) {
	var n int64
	err := s.db.QueryRow(`SELECT COUNT(*) FROM users WHERE role='admin'`).Scan(&n)
	return n, err
}

func (s *Store) GetSiteSettings() (SiteSettings, error) {
	var ss SiteSettings
	var reg int64
	err := s.db.QueryRow(`
SELECT product_name, product_tagline, logo_url, accent_hex, registration_open, updated_at
FROM site_settings WHERE id=1`).
		Scan(&ss.ProductName, &ss.ProductTagline, &ss.LogoURL, &ss.AccentHex, &reg, &ss.UpdatedAt)
	ss.RegistrationOpen = reg != 0
	return ss, err
}

func (s *Store) AccessCodeActive() (bool, error) {
	var h string
	err := s.db.QueryRow(`SELECT access_code_hash FROM site_settings WHERE id=1`).Scan(&h)
	if err != nil {
		return false, err
	}
	return strings.TrimSpace(h) != "", nil
}

func (s *Store) RegistrationAllowed() (bool, error) {
	ss, err := s.GetSiteSettings()
	if err != nil {
		return false, err
	}
	return ss.RegistrationOpen, nil
}

func (s *Store) PatchSiteSettings(productName, tagline, logoURL, accentHex *string, registrationOpen *bool, plainAccessCode *string, clearAccessCode bool) error {
	var pn, tg, lu, ah, ach string
	var reg int64
	err := s.db.QueryRow(`
SELECT product_name, product_tagline, logo_url, accent_hex, registration_open, access_code_hash
FROM site_settings WHERE id=1`).
		Scan(&pn, &tg, &lu, &ah, &reg, &ach)
	if err != nil {
		return err
	}
	if productName != nil {
		v := strings.TrimSpace(*productName)
		if v != "" {
			pn = v
		}
	}
	if tagline != nil {
		tg = strings.TrimSpace(*tagline)
	}
	if logoURL != nil {
		lu = strings.TrimSpace(*logoURL)
	}
	if accentHex != nil {
		v := strings.TrimSpace(*accentHex)
		if v != "" {
			ah = v
		}
	}
	if registrationOpen != nil {
		if *registrationOpen {
			reg = 1
		} else {
			reg = 0
		}
	}
	if clearAccessCode {
		ach = ""
	} else if plainAccessCode != nil {
		p := strings.TrimSpace(*plainAccessCode)
		if p != "" {
			h, err := bcrypt.GenerateFromPassword([]byte(p), bcrypt.DefaultCost)
			if err != nil {
				return err
			}
			ach = string(h)
		}
	}
	ts := time.Now().UnixMilli()
	_, err = s.db.Exec(`
UPDATE site_settings SET product_name=?, product_tagline=?, logo_url=?, accent_hex=?, registration_open=?, access_code_hash=?, updated_at=? WHERE id=1`,
		pn, tg, lu, ah, reg, ach, ts)
	return err
}

func (s *Store) VerifyAccessCode(code string) (bool, error) {
	var h string
	err := s.db.QueryRow(`SELECT access_code_hash FROM site_settings WHERE id=1`).Scan(&h)
	if err != nil {
		return false, err
	}
	if strings.TrimSpace(h) == "" {
		return true, nil
	}
	return bcrypt.CompareHashAndPassword([]byte(h), []byte(code)) == nil, nil
}

func (s *Store) UserByCredentials(username, password string) (*User, error) {
	var id, user, hash, role string
	var ts int64
	err := s.db.QueryRow(`
SELECT id, username, password_hash, role, created_at FROM users WHERE username=? COLLATE NOCASE`,
		strings.TrimSpace(username)).Scan(&id, &user, &hash, &role, &ts)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) != nil {
		return nil, nil
	}
	return &User{ID: id, Username: user, Role: role, CreatedAt: ts}, nil
}

func (s *Store) CreateUser(username, password, role string) (User, error) {
	username = strings.TrimSpace(username)
	if username == "" || len(password) < 8 {
		return User{}, errors.New("username or password invalid")
	}
	if role != "admin" && role != "user" {
		role = "user"
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return User{}, err
	}
	id := uuid.NewString()
	ts := time.Now().UnixMilli()
	_, err = s.db.Exec(`INSERT INTO users(id,username,password_hash,role,created_at) VALUES(?,?,?,?,?)`,
		id, username, string(hash), role, ts)
	if err != nil {
		return User{}, err
	}
	return User{ID: id, Username: username, Role: role, CreatedAt: ts}, nil
}

func (s *Store) ListUsers() ([]User, error) {
	rows, err := s.db.Query(`SELECT id, username, role, created_at FROM users ORDER BY created_at`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []User
	for rows.Next() {
		var u User
		if err := rows.Scan(&u.ID, &u.Username, &u.Role, &u.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, u)
	}
	return out, rows.Err()
}

func (s *Store) DeleteUser(targetID, actorID string) error {
	if targetID == actorID {
		return errors.New("cannot delete self")
	}
	var cnt int64
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM users WHERE role='admin'`).Scan(&cnt); err != nil {
		return err
	}
	var role string
	err := s.db.QueryRow(`SELECT role FROM users WHERE id=?`, targetID).Scan(&role)
	if err == sql.ErrNoRows {
		return errors.New("not found")
	}
	if err != nil {
		return err
	}
	if role == "admin" && cnt <= 1 {
		return errors.New("last admin")
	}
	_, err = s.db.Exec(`DELETE FROM users WHERE id=?`, targetID)
	return err
}

func randomSessionToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

func (s *Store) CreateSession(userID string, ttl time.Duration) (string, error) {
	token, err := randomSessionToken()
	if err != nil {
		return "", err
	}
	exp := time.Now().Add(ttl).UnixMilli()
	_, err = s.db.Exec(`INSERT INTO sessions(token,user_id,expires_at) VALUES(?,?,?)`, token, userID, exp)
	return token, err
}

func (s *Store) UserBySessionToken(token string) (*User, bool, error) {
	if strings.TrimSpace(token) == "" {
		return nil, false, nil
	}
	now := time.Now().UnixMilli()
	var u User
	err := s.db.QueryRow(`
SELECT u.id, u.username, u.role, u.created_at FROM sessions s
JOIN users u ON u.id = s.user_id
WHERE s.token = ? AND s.expires_at > ?
`, token, now).Scan(&u.ID, &u.Username, &u.Role, &u.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	return &u, true, nil
}

func (s *Store) DeleteSession(token string) error {
	_, err := s.db.Exec(`DELETE FROM sessions WHERE token=?`, token)
	return err
}
