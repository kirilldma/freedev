package main

import (
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/kirilldma/freedev/internal/app"
)

func main() {
	addr := getenv("FREEDEV_ADDR", "0.0.0.0:8787")
	dataDir := getenv("FREEDEV_DATA", filepath.Join(".", "data"))
	a, err := app.New(dataDir)
	if err != nil {
		log.Fatal(err)
	}
	defer a.Close()
	log.Printf("freedev listen=%s data=%s", addr, dataDir)
	if err := http.ListenAndServe(addr, a.Handler()); err != nil {
		log.Fatal(err)
	}
}

func getenv(k, def string) string {
	if s := strings.TrimSpace(os.Getenv(k)); s != "" {
		return s
	}
	return def
}
