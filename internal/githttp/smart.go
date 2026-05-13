package githttp

import (
	"io"
	"net/http"
	"os/exec"
	"strings"

	"github.com/kirilldma/freedev/internal/store"
)

func Available() bool {
	_, err := exec.LookPath("git")
	return err == nil
}

func advertiseUploadPack(repo string, w http.ResponseWriter) {
	w.Header().Set("Content-Type", "application/x-git-upload-pack-advertisement")
	w.Header().Set("Cache-Control", "no-cache")
	w.WriteHeader(http.StatusOK)
	cmd := exec.Command("git", "-C", repo, "upload-pack", "--stateless-rpc", "--advertise-refs", ".")
	cmd.Stdout = w
	cmd.Stderr = io.Discard
	_ = cmd.Run()
}

func rpcUploadPack(repo string, r *http.Request, w http.ResponseWriter) {
	w.Header().Set("Content-Type", "application/x-git-upload-pack-result")
	w.Header().Set("Cache-Control", "no-cache")
	w.WriteHeader(http.StatusOK)
	cmd := exec.Command("git", "-C", repo, "upload-pack", "--stateless-rpc", ".")
	cmd.Stdin = r.Body
	cmd.Stdout = w
	cmd.Stderr = io.Discard
	_ = cmd.Run()
}

func advertiseReceivePack(repo string, w http.ResponseWriter) {
	w.Header().Set("Content-Type", "application/x-git-receive-pack-advertisement")
	w.Header().Set("Cache-Control", "no-cache")
	w.WriteHeader(http.StatusOK)
	cmd := exec.Command("git", "-C", repo, "receive-pack", "--stateless-rpc", "--advertise-refs", ".")
	cmd.Stdout = w
	cmd.Stderr = io.Discard
	_ = cmd.Run()
}

func rpcReceivePack(repo string, r *http.Request, w http.ResponseWriter) {
	w.Header().Set("Content-Type", "application/x-git-receive-pack-result")
	w.Header().Set("Cache-Control", "no-cache")
	w.WriteHeader(http.StatusOK)
	cmd := exec.Command("git", "-C", repo, "receive-pack", "--stateless-rpc", ".")
	cmd.Stdin = r.Body
	cmd.Stdout = w
	cmd.Stderr = io.Discard
	_ = cmd.Run()
}

func SmartHandler(st *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !Available() {
			http.Error(w, "git CLI not found in PATH", http.StatusServiceUnavailable)
			return
		}
		rest := strings.TrimPrefix(r.URL.Path, "/git/")
		rest = strings.Trim(rest, "/")
		if rest == "" {
			http.NotFound(w, r)
			return
		}
		parts := strings.SplitN(rest, ".git/", 2)
		if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
			http.NotFound(w, r)
			return
		}
		slug := parts[0]
		sub := strings.Trim(parts[1], "/")
		g, ok, err := st.GetGitRepo(slug)
		if err != nil || !ok {
			http.NotFound(w, r)
			return
		}
		path := st.BareRepoPath(g.Slug)
		switch sub {
		case "info/refs":
			if r.Method != http.MethodGet {
				http.Error(w, "method", http.StatusMethodNotAllowed)
				return
			}
			svc := r.URL.Query().Get("service")
			switch svc {
			case "git-upload-pack":
				advertiseUploadPack(path, w)
			case "git-receive-pack":
				advertiseReceivePack(path, w)
			default:
				http.NotFound(w, r)
			}
		case "git-upload-pack":
			if r.Method != http.MethodPost {
				http.Error(w, "method", http.StatusMethodNotAllowed)
				return
			}
			rpcUploadPack(path, r, w)
		case "git-receive-pack":
			if r.Method != http.MethodPost {
				http.Error(w, "method", http.StatusMethodNotAllowed)
				return
			}
			rpcReceivePack(path, r, w)
		default:
			http.NotFound(w, r)
		}
	}
}
