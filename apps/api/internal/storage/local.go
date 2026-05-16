package storage

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"

	"github.com/gdgoc/admin-api/internal/config"
)

// localBackend stores files on the local filesystem under a configurable base directory.
// Assets are served at /assets/<key> and certificates at /certs/<key> via the
// Fiber static file middleware (configured in server.go).
type localBackend struct {
	baseDir      string
	bucketAssets string
	bucketCerts  string
	publicPrefix string // URL prefix where the base dir is mounted, e.g. "/files"
}

func newLocalBackend(cfg config.StorageConfig) (*localBackend, error) {
	base := cfg.LocalDir
	if base == "" {
		base = "./data"
	}
	for _, sub := range []string{cfg.BucketAssets, cfg.BucketCerts} {
		if err := os.MkdirAll(filepath.Join(base, sub), 0o755); err != nil {
			return nil, fmt.Errorf("local storage: create dir %s: %w", sub, err)
		}
	}
	prefix := cfg.PublicPrefix
	if prefix == "" {
		prefix = "/files"
	}
	return &localBackend{
		baseDir:      base,
		bucketAssets: cfg.BucketAssets,
		bucketCerts:  cfg.BucketCerts,
		publicPrefix: prefix,
	}, nil
}

func (b *localBackend) EnsureBuckets(_ context.Context) error { return nil }

func (b *localBackend) UploadAsset(_ context.Context, objectKey string, r io.Reader, _ int64, _ string) (string, error) {
	return b.write(b.bucketAssets, objectKey, r)
}

func (b *localBackend) UploadCertificate(_ context.Context, objectKey string, r io.Reader, _ int64, _ string) (string, error) {
	return b.write(b.bucketCerts, objectKey, r)
}

func (b *localBackend) write(bucket, objectKey string, r io.Reader) (string, error) {
	dest := filepath.Join(b.baseDir, bucket, filepath.FromSlash(objectKey))
	if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
		return "", fmt.Errorf("local storage: mkdirall: %w", err)
	}
	f, err := os.Create(dest)
	if err != nil {
		return "", fmt.Errorf("local storage: create file: %w", err)
	}
	defer f.Close()
	if _, err := io.Copy(f, r); err != nil {
		return "", fmt.Errorf("local storage: write file: %w", err)
	}
	return objectKey, nil
}

func (b *localBackend) GetAssetURL(objectKey string) string {
	return fmt.Sprintf("%s/%s/%s", b.publicPrefix, b.bucketAssets, objectKey)
}

func (b *localBackend) GetCertURL(objectKey string) string {
	return fmt.Sprintf("%s/%s/%s", b.publicPrefix, b.bucketCerts, objectKey)
}

func (b *localBackend) GetObject(_ context.Context, bucket, objectKey string) (io.ReadCloser, error) {
	path := filepath.Join(b.baseDir, bucket, filepath.FromSlash(objectKey))
	f, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("local storage: open %s: %w", path, err)
	}
	return f, nil
}

func (b *localBackend) BucketAssets() string { return b.bucketAssets }
func (b *localBackend) BucketCerts() string  { return b.bucketCerts }

func (b *localBackend) DeleteObject(_ context.Context, bucket, objectKey string) error {
	path := filepath.Join(b.baseDir, bucket, filepath.FromSlash(objectKey))
	err := os.Remove(path)
	if err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("local storage: delete %s: %w", path, err)
	}
	return nil
}
