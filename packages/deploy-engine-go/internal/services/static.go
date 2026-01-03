package services

import (
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

type StaticServer struct {
	rootDir string
}

func NewStaticServer(rootDir string) *StaticServer {
	return &StaticServer{rootDir: rootDir}
}

func (s *StaticServer) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	path := filepath.Clean(r.URL.Path)
	if path == "/" {
		path = "/index.html"
	}

	fullPath := filepath.Join(s.rootDir, path)

	// Check if file exists
	info, err := os.Stat(fullPath)
	if err != nil {
		// SPA fallback: serve index.html for all 404s
		indexPath := filepath.Join(s.rootDir, "index.html")
		if _, indexErr := os.Stat(indexPath); indexErr == nil {
			http.ServeFile(w, r, indexPath)
			return
		}
		http.NotFound(w, r)
		return
	}

	// If directory, try index.html
	if info.IsDir() {
		indexPath := filepath.Join(fullPath, "index.html")
		if _, err := os.Stat(indexPath); err == nil {
			fullPath = indexPath
		} else {
			http.NotFound(w, r)
			return
		}
	}

	// Set cache headers for static assets
	if isStaticAsset(path) {
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	} else {
		w.Header().Set("Cache-Control", "no-cache")
	}

	http.ServeFile(w, r, fullPath)
}

func isStaticAsset(path string) bool {
	ext := strings.ToLower(filepath.Ext(path))
	staticExts := map[string]bool{
		".js": true, ".css": true, ".woff": true, ".woff2": true,
		".ttf": true, ".eot": true, ".svg": true, ".png": true,
		".jpg": true, ".jpeg": true, ".gif": true, ".ico": true,
		".webp": true, ".avif": true, ".mp4": true, ".webm": true,
	}
	return staticExts[ext]
}

func ServeStatic(w http.ResponseWriter, r *http.Request, root string) {
	server := NewStaticServer(root)
	server.ServeHTTP(w, r)
}

func FindDistDir(cwd string) string {
	candidates := []string{"dist", "build", "out", ".next/static", "public"}
	for _, dir := range candidates {
		full := filepath.Join(cwd, dir)
		if info, err := os.Stat(full); err == nil && info.IsDir() {
			return full
		}
	}
	return cwd
}

func WalkDir(root string, fn fs.WalkDirFunc) error {
	return filepath.WalkDir(root, fn)
}
