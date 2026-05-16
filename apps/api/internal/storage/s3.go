package storage

import (
	"context"
	"fmt"
	"io"

	"github.com/gdgoc/admin-api/internal/config"
	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

// s3Backend works with any S3-compatible service: AWS S3, MinIO, Wasabi, etc.
// Set STORAGE_DRIVER=s3 (or minio) in your environment.
type s3Backend struct {
	mc           *minio.Client
	bucketAssets string
	bucketCerts  string
	publicBase   string // optional CDN / public endpoint base URL for URL generation
}

func newS3Backend(cfg config.StorageConfig) (*s3Backend, error) {
	mc, err := minio.New(cfg.Endpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(cfg.AccessKey, cfg.SecretKey, ""),
		Secure: cfg.UseSSL,
	})
	if err != nil {
		return nil, fmt.Errorf("s3 storage: init client: %w", err)
	}
	scheme := "http"
	if cfg.UseSSL {
		scheme = "https"
	}
	return &s3Backend{
		mc:           mc,
		bucketAssets: cfg.BucketAssets,
		bucketCerts:  cfg.BucketCerts,
		publicBase:   fmt.Sprintf("%s://%s", scheme, cfg.Endpoint),
	}, nil
}

func (b *s3Backend) EnsureBuckets(ctx context.Context) error {
	for _, bucket := range []string{b.bucketAssets, b.bucketCerts} {
		exists, err := b.mc.BucketExists(ctx, bucket)
		if err != nil {
			return fmt.Errorf("s3 storage: check bucket %s: %w", bucket, err)
		}
		if !exists {
			if err := b.mc.MakeBucket(ctx, bucket, minio.MakeBucketOptions{}); err != nil {
				return fmt.Errorf("s3 storage: create bucket %s: %w", bucket, err)
			}
		}
	}
	return nil
}

func (b *s3Backend) UploadAsset(ctx context.Context, objectKey string, r io.Reader, size int64, contentType string) (string, error) {
	_, err := b.mc.PutObject(ctx, b.bucketAssets, objectKey, r, size, minio.PutObjectOptions{ContentType: contentType})
	if err != nil {
		return "", fmt.Errorf("s3 storage: upload asset: %w", err)
	}
	return objectKey, nil
}

func (b *s3Backend) UploadCertificate(ctx context.Context, objectKey string, r io.Reader, size int64, contentType string) (string, error) {
	_, err := b.mc.PutObject(ctx, b.bucketCerts, objectKey, r, size, minio.PutObjectOptions{ContentType: contentType})
	if err != nil {
		return "", fmt.Errorf("s3 storage: upload certificate: %w", err)
	}
	return objectKey, nil
}

func (b *s3Backend) GetAssetURL(objectKey string) string {
	return fmt.Sprintf("%s/%s/%s", b.publicBase, b.bucketAssets, objectKey)
}

func (b *s3Backend) GetCertURL(objectKey string) string {
	return fmt.Sprintf("%s/%s/%s", b.publicBase, b.bucketCerts, objectKey)
}

func (b *s3Backend) GetObject(ctx context.Context, bucket, objectKey string) (io.ReadCloser, error) {
	obj, err := b.mc.GetObject(ctx, bucket, objectKey, minio.GetObjectOptions{})
	if err != nil {
		return nil, fmt.Errorf("s3 storage: get object: %w", err)
	}
	return obj, nil
}

func (b *s3Backend) BucketAssets() string { return b.bucketAssets }
func (b *s3Backend) BucketCerts() string  { return b.bucketCerts }

func (b *s3Backend) DeleteObject(ctx context.Context, bucket, objectKey string) error {
	err := b.mc.RemoveObject(ctx, bucket, objectKey, minio.RemoveObjectOptions{})
	if err != nil {
		// Treat "not found" as success (idempotent)
		if minio.ToErrorResponse(err).Code == "NoSuchKey" {
			return nil
		}
		return fmt.Errorf("s3 storage: delete %s/%s: %w", bucket, objectKey, err)
	}
	return nil
}
