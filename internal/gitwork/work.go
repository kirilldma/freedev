package gitwork

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"strings"
)

func HasGit() bool {
	_, err := exec.LookPath("git")
	return err == nil
}

var ErrNoGit = errors.New("git executable not found")

func SafeRelPath(p string) (string, error) {
	p = filepath.ToSlash(strings.TrimSpace(p))
	p = strings.TrimPrefix(p, "/")
	if p == "" {
		return "", errors.New("empty path")
	}
	c := path.Clean(p)
	if c == "." || c == ".." || strings.HasPrefix(c, "../") {
		return "", errors.New("invalid path")
	}
	return c, nil
}

func clonePrepare(ctx context.Context, bare, workDir, wantBranch string) (branch string, err error) {
	if _, err := os.Stat(bare); err != nil {
		return "", err
	}
	cmd := exec.CommandContext(ctx, "git", "clone", "--quiet", bare, workDir)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("git clone: %w\n%s", err, strings.TrimSpace(string(out)))
	}

	headOK := exec.CommandContext(ctx, "git", "-C", workDir, "rev-parse", "--verify", "HEAD")
	if headOkErr := headOK.Run(); headOkErr != nil {
		b := wantBranch
		if b == "" {
			b = "main"
		}
		co := exec.CommandContext(ctx, "git", "-C", workDir, "checkout", "-b", b)
		if out2, err2 := co.CombinedOutput(); err2 != nil {
			return "", fmt.Errorf("git checkout -b (empty repo): %w\n%s", err2, strings.TrimSpace(string(out2)))
		}
		return b, nil
	}

	curOut, err := exec.CommandContext(ctx, "git", "-C", workDir, "rev-parse", "--abbrev-ref", "HEAD").Output()
	if err != nil {
		return "", fmt.Errorf("git rev-parse HEAD: %w", err)
	}
	current := strings.TrimSpace(string(curOut))
	if wantBranch == "" || wantBranch == current {
		return current, nil
	}

	co := exec.CommandContext(ctx, "git", "-C", workDir, "checkout", wantBranch)
	if co.Run() == nil {
		return wantBranch, nil
	}
	cb := exec.CommandContext(ctx, "git", "-C", workDir, "checkout", "-b", wantBranch)
	if out3, err3 := cb.CombinedOutput(); err3 != nil {
		return "", fmt.Errorf("git checkout %q: %w\n%s", wantBranch, err3, strings.TrimSpace(string(out3)))
	}
	return wantBranch, nil
}

func gitEnv() []string {
	return append(os.Environ(),
		"GIT_TERMINAL_PROMPT=0",
		"GIT_AUTHOR_NAME=FreeDev",
		"GIT_AUTHOR_EMAIL=freedev@localhost",
		"GIT_COMMITTER_NAME=FreeDev",
		"GIT_COMMITTER_EMAIL=freedev@localhost",
	)
}

func CommitAdd(ctx context.Context, bare, branchWant, relPath string, data []byte, msg string) error {
	if !HasGit() {
		return ErrNoGit
	}
	if strings.TrimSpace(msg) == "" {
		msg = "update " + relPath
	}
	var err error
	relPath, err = SafeRelPath(relPath)
	if err != nil {
		return err
	}
	parent, err := os.MkdirTemp("", "fd-git-*")
	if err != nil {
		return err
	}
	defer os.RemoveAll(parent)
	workDir := filepath.Join(parent, "wt")

	branch, err := clonePrepare(ctx, bare, workDir, branchWant)
	if err != nil {
		return err
	}

	full := filepath.Join(workDir, filepath.FromSlash(relPath))
	if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
		return err
	}
	if err := os.WriteFile(full, data, 0o644); err != nil {
		return err
	}

	run := func(args ...string) ([]byte, error) {
		c := exec.CommandContext(ctx, "git", args...)
		c.Dir = workDir
		c.Env = gitEnv()
		return c.CombinedOutput()
	}

	slashPath := filepath.ToSlash(relPath)
	out, err := run("add", "--", slashPath)
	if err != nil {
		return fmt.Errorf("git add: %w\n%s", err, strings.TrimSpace(string(out)))
	}
	out, err = run("commit", "-m", msg)
	if err != nil {
		return fmt.Errorf("git commit: %w\n%s", err, strings.TrimSpace(string(out)))
	}
	if err := pushUpstream(ctx, workDir, branch); err != nil {
		return err
	}
	return nil
}

func CommitRemove(ctx context.Context, bare, branchWant, relPath, msg string, recursive bool) error {
	if !HasGit() {
		return ErrNoGit
	}
	if strings.TrimSpace(msg) == "" {
		msg = "remove " + relPath
	}
	var err error
	relPath, err = SafeRelPath(relPath)
	if err != nil {
		return err
	}
	parent, err := os.MkdirTemp("", "fd-git-*")
	if err != nil {
		return err
	}
	defer os.RemoveAll(parent)
	workDir := filepath.Join(parent, "wt")

	branch, err := clonePrepare(ctx, bare, workDir, branchWant)
	if err != nil {
		return err
	}

	run := func(args ...string) ([]byte, error) {
		c := exec.CommandContext(ctx, "git", args...)
		c.Dir = workDir
		c.Env = gitEnv()
		return c.CombinedOutput()
	}

	slashPath := filepath.ToSlash(relPath)
	args := []string{"rm"}
	if recursive {
		args = append(args, "-r")
	}
	args = append(args, "--", slashPath)
	out, err := run(args...)
	if err != nil {
		return fmt.Errorf("git rm: %w\n%s", err, strings.TrimSpace(string(out)))
	}
	out, err = run("commit", "-m", msg)
	if err != nil {
		return fmt.Errorf("git commit: %w\n%s", err, strings.TrimSpace(string(out)))
	}
	if err := pushUpstream(ctx, workDir, branch); err != nil {
		return err
	}
	return nil
}

func pushUpstream(ctx context.Context, workDir, branch string) error {
	run := func(args ...string) ([]byte, error) {
		c := exec.CommandContext(ctx, "git", args...)
		c.Dir = workDir
		c.Env = gitEnv()
		return c.CombinedOutput()
	}
	var last []byte
	for range 12 {
		out, err := run("push", "-u", "origin", branch)
		if err == nil {
			return nil
		}
		last = out
		s := strings.ToLower(string(out))
		rejected := strings.Contains(s, "non-fast-forward") ||
			strings.Contains(s, "[rejected]") ||
			strings.Contains(s, "updates were rejected") ||
			strings.Contains(s, "! [remote rejected]")
		if !rejected {
			return fmt.Errorf("git push: %w\n%s", err, strings.TrimSpace(string(out)))
		}
		out2, err2 := run("pull", "--no-edit", "--rebase", "origin", branch)
		if err2 != nil {
			return fmt.Errorf("git pull --rebase: %w\n%s", err2, strings.TrimSpace(string(out2)))
		}
	}
	return fmt.Errorf("git push: gave up after retries\n%s", strings.TrimSpace(string(last)))
}
