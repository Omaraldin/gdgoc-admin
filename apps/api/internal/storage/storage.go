package storage

import (
	"context"
	"fmt"
	"io"

	"github.com/gdgoc/admin-api/internal/config"
)

// Backend is the single interface every storage driver must satisfy.
type Backend interface {
	// EnsureBuckets creates the asset and certificate containers if they
	// do not already exist. Drivers that do not need this (e.g. local) return nil.
	EnsureBuckets(ctx context.Context) error

	// UploadAsset stores a template asset (image, font, etc.) and returns the object key.
	UploadAsset(ctx context.Context, objectKey string, r io.Reader, size int64, contentType string) (string, error)

	// UploadCertificate stores a generated certificate file and returns the object key.
	UploadCertificate(ctx context.Context, objectKey string, r io.Reader, size int64, contentType string) (string, error)

	// GetAssetURL returns the public URL / path for an asset object key.
	GetAssetURL(objectKey string) string

	// GetCertURL returns the public URL / path for a certificate object key.
	GetCertURL(objectKey string) string

	// GetObject returns a readable stream for any object.
	// bucket is the logical bucket name (use BucketAssets() or BucketCerts()).
	GetObject(ctx context.Context, bucket, objectKey string) (io.ReadCloser, error)

	// DeleteObject removes an object from the given bucket. Returns nil if the object
	// did not exist (idempotent).
	DeleteObject(ctx context.Context, bucket, objectKey string) error

	// BucketAssets / BucketCerts expose the configured bucket/folder names.
	BucketAssets() string
	BucketCerts() string
}

// New selects and initialises the storage backend from cfg.Driver:
//
// "local"            - local filesystem (no external service needed, default)
// "s3" / "minio"     - S3-compatible (AWS S3, MinIO, Wasabi, …)
// "cloudinary"       - Cloudinary media API
func New(cfg config.StorageConfig) (Backend, error) {
	switch cfg.Driver {
	case "local", "":
		return newLocalBackend(cfg)
	case "s3", "minio":
		return newS3Backend(cfg)
	case "cloudinary":
		return newCloudinaryBackend(cfg)
	default:
		return nil, fmt.Errorf("storage: unknown driver %q — choose local, s3, minio, or cloudinary", cfg.Driver)
	}
}
