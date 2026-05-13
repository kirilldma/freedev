package gitbrowse

import (
	"archive/zip"
	"bytes"
	"errors"
	"io"
	"strings"

	"github.com/go-git/go-git/v5"
	"github.com/go-git/go-git/v5/plumbing"
	"github.com/go-git/go-git/v5/plumbing/filemode"
	"github.com/go-git/go-git/v5/plumbing/object"
)

var ErrEmptyRepo = errors.New("empty repository")

const MaxBlobPreview = 512 * 1024

var ErrZipTooLarge = errors.New("archive exceeds size limit")

type TreeEntry struct {
	Name string `json:"name"`
	Path string `json:"path"`
	Type string `json:"type"`
	Size int64  `json:"size"`
	Mode string `json:"mode"`
}

type CommitSummary struct {
	Hash      string `json:"hash"`
	Author    string `json:"author"`
	Message   string `json:"message"`
	Timestamp int64  `json:"timestamp"`
}

type Branch struct {
	Name string `json:"name"`
	Hash string `json:"hash"`
}

func Open(path string) (*git.Repository, error) {
	return git.PlainOpen(path)
}

func resolveCommit(r *git.Repository, ref string) (*object.Commit, error) {
	ref = strings.TrimSpace(ref)
	if ref == "" {
		head, err := r.Head()
		if err != nil {
			return nil, ErrEmptyRepo
		}
		return r.CommitObject(head.Hash())
	}
	h, err := r.ResolveRevision(plumbing.Revision(ref))
	if err != nil {
		return nil, err
	}
	if h == nil {
		return nil, ErrEmptyRepo
	}
	return r.CommitObject(*h)
}

func TreeList(r *git.Repository, ref, dir string) ([]TreeEntry, error) {
	c, err := resolveCommit(r, ref)
	if err != nil {
		return nil, err
	}
	t, err := c.Tree()
	if err != nil {
		return nil, err
	}
	base := strings.Trim(strings.TrimPrefix(dir, "/"), "/")
	if base != "" {
		t, err = t.Tree(base)
		if err != nil {
			return nil, err
		}
	}
	var out []TreeEntry
	for _, e := range t.Entries {
		p := e.Name
		if base != "" {
			p = base + "/" + e.Name
		}
		typ := "blob"
		if e.Mode == filemode.Dir {
			typ = "tree"
		}
		out = append(out, TreeEntry{
			Name: e.Name,
			Path: p,
			Type: typ,
			Size: 0,
			Mode: e.Mode.String(),
		})
	}
	return out, nil
}

func BlobReader(r *git.Repository, ref, filePath string) (io.ReadCloser, int64, error) {
	c, err := resolveCommit(r, ref)
	if err != nil {
		return nil, 0, err
	}
	f, err := c.File(strings.Trim(filePath, "/"))
	if err != nil {
		return nil, 0, err
	}
	reader, err := f.Reader()
	if err != nil {
		return nil, 0, err
	}
	return reader, f.Size, nil
}

func Commits(r *git.Repository, ref string, limit int) ([]CommitSummary, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	c, err := resolveCommit(r, ref)
	if err != nil {
		return nil, err
	}
	iter, err := r.Log(&git.LogOptions{From: c.Hash})
	if err != nil {
		return nil, err
	}
	defer iter.Close()
	var out []CommitSummary
	for len(out) < limit {
		cc, err := iter.Next()
		if err != nil {
			break
		}
		out = append(out, CommitSummary{
			Hash:      cc.Hash.String(),
			Author:    cc.Author.Name,
			Message:   strings.TrimSpace(strings.SplitN(cc.Message, "\n", 2)[0]),
			Timestamp: cc.Author.When.UnixMilli(),
		})
	}
	return out, nil
}

func Branches(r *git.Repository) ([]Branch, error) {
	iter, err := r.References()
	if err != nil {
		return nil, err
	}
	var out []Branch
	err = iter.ForEach(func(ref *plumbing.Reference) error {
		if ref.Type() != plumbing.HashReference {
			return nil
		}
		name := ref.Name().String()
		const p = "refs/heads/"
		if !strings.HasPrefix(name, p) {
			return nil
		}
		out = append(out, Branch{
			Name: strings.TrimPrefix(name, p),
			Hash: ref.Hash().String(),
		})
		return nil
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

type Tag struct {
	Name        string `json:"name"`
	Hash        string `json:"hash"`
	CommitHash  string `json:"commit_hash"`
}

func Tags(r *git.Repository) ([]Tag, error) {
	iter, err := r.Tags()
	if err != nil {
		return nil, err
	}
	defer iter.Close()
	var out []Tag
	err = iter.ForEach(func(ref *plumbing.Reference) error {
		name := ref.Name().Short()
		h := ref.Hash()
		commitHash := h.String()
		to, err := r.TagObject(h)
		if err == nil {
			commitHash = to.Target.String()
		}
		out = append(out, Tag{Name: name, Hash: h.String(), CommitHash: commitHash})
		return nil
	})
	return out, err
}

func BlobPreview(r *git.Repository, ref, filePath string) (raw []byte, truncated bool, binary bool, totalSize int64, err error) {
	rc, sz, err := BlobReader(r, ref, filePath)
	if err != nil {
		return nil, false, false, 0, err
	}
	defer rc.Close()
	buf := bytes.NewBuffer(make([]byte, 0, MaxBlobPreview+1))
	n, err := io.CopyN(buf, rc, int64(MaxBlobPreview)+1)
	if err != nil && err != io.EOF {
		return nil, false, false, sz, err
	}
	out := buf.Bytes()
	trunc := n > int64(MaxBlobPreview)
	if trunc {
		out = out[:MaxBlobPreview]
	}
	if sz >= 0 && sz > int64(len(out)) {
		trunc = true
	}
	bin := bytes.IndexByte(out, 0) >= 0
	return out, trunc, bin, sz, nil
}

func DiffCommits(r *git.Repository, baseRef, headRef string, maxOut int) (string, error) {
	if maxOut <= 0 || maxOut > 4<<20 {
		maxOut = 512 << 10
	}
	bc, err := resolveCommit(r, baseRef)
	if err != nil {
		return "", err
	}
	hc, err := resolveCommit(r, headRef)
	if err != nil {
		return "", err
	}
	bt, err := bc.Tree()
	if err != nil {
		return "", err
	}
	ht, err := hc.Tree()
	if err != nil {
		return "", err
	}
	patch, err := bt.Patch(ht)
	if err != nil {
		return "", err
	}
	s := patch.String()
	if len(s) > maxOut {
		s = s[:maxOut] + "\n… truncated …\n"
	}
	return s, nil
}

func WriteZip(w io.Writer, r *git.Repository, ref string, maxTotalBytes int64) error {
	c, err := resolveCommit(r, ref)
	if err != nil {
		return err
	}
	t, err := c.Tree()
	if err != nil {
		return err
	}
	zw := zip.NewWriter(w)
	defer zw.Close()
	var written int64
	return zipTree(zw, t, "", &written, maxTotalBytes)
}

func zipTree(zw *zip.Writer, tree *object.Tree, prefix string, written *int64, maxTotal int64) error {
	for _, e := range tree.Entries {
		name := e.Name
		path := name
		if prefix != "" {
			path = prefix + "/" + name
		}
		switch e.Mode {
		case filemode.Dir:
			sub, err := tree.Tree(name)
			if err != nil {
				return err
			}
			if err := zipTree(zw, sub, path, written, maxTotal); err != nil {
				return err
			}
			continue
		case filemode.Symlink:
			continue
		default:
			f, err := tree.File(name)
			if err != nil {
				return err
			}
			rc, err := f.Reader()
			if err != nil {
				return err
			}
			hdr := &zip.FileHeader{Name: path, Method: zip.Deflate}
			dst, err := zw.CreateHeader(hdr)
			if err != nil {
				rc.Close()
				return err
			}
			n, err := io.Copy(dst, rc)
			rc.Close()
			if err != nil {
				return err
			}
			*written += n
			if maxTotal > 0 && *written > maxTotal {
				return ErrZipTooLarge
			}
		}
	}
	return nil
}
