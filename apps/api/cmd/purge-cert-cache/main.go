// purge-cert-cache is a standalone CLI binary intended to be run as a
// scheduled cron job (e.g. weekly).  It deletes every rendered certificate
// file under CERT_CACHE_DIR so the directory does not grow unbounded.
//
// Usage:
//
//	purge-cert-cache
//
// Exit codes:
//
//	0  success
//	1  error (details printed to stderr)
package main

import (
	"fmt"
	"log"
	"os"

	"github.com/gdgoc/admin-api/internal/domain/issuance"
	"github.com/joho/godotenv"
)

func main() {
	// Load .env if present — same search order as the API server.
	if err := godotenv.Load(); err != nil {
		_ = godotenv.Load("../../.env")
	}

	cacheDir := os.Getenv("CERT_CACHE_DIR")
	if cacheDir == "" {
		cacheDir = "./cert_cache"
	}

	dc, err := issuance.NewDiskCache(cacheDir)
	if err != nil {
		fmt.Fprintf(os.Stderr, "purge-cert-cache: init: %v\n", err)
		os.Exit(1)
	}

	log.Printf("purge-cert-cache: purging %s", cacheDir)
	if err := dc.Purge(); err != nil {
		fmt.Fprintf(os.Stderr, "purge-cert-cache: %v\n", err)
		os.Exit(1)
	}
	log.Printf("purge-cert-cache: done")
}
