package storage

import (
	"bytes"
	"context"
	"crypto/sha1"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/gdgoc/admin-api/internal/config"
)

// cloudinaryBackend stores files via the Cloudinary Upload API (signed uploads).
// Set STORAGE_DRIVER=cloudinary and:
//
//	STORAGE_CLOUDINARY_CLOUD_NAME=<cloud_name>
//	STORAGE_ACCESS_KEY=<api_key>
//	STORAGE_SECRET_KEY=<api_secret>
type cloudinaryBackend struct {
	cloudName    string
	apiKey       string
	apiSecret    string
	bucketAssets string
	bucketCerts  string
	httpClient   *http.Client
}

func newCloudinaryBackend(cfg config.StorageConfig) (*cloudinaryBackend, error) {
	if cfg.CloudName == "" {
		return nil, fmt.Errorf("cloudinary: STORAGE_CLOUDINARY_CLOUD_NAME is required")
	}
	if cfg.AccessKey == "" {
		return nil, fmt.Errorf("cloudinary: STORAGE_ACCESS_KEY (api key) is required")
	}
	if cfg.SecretKey == "" {
		return nil, fmt.Errorf("cloudinary: STORAGE_SECRET_KEY (api secret) is required")
	}
	return &cloudinaryBackend{
		cloudName:    cfg.CloudName,
		apiKey:       cfg.AccessKey,
		apiSecret:    cfg.SecretKey,
		bucketAssets: cfg.BucketAssets,
		httpClient:   &http.Client{Timeout: 30 * time.Second},
		bucketCerts:  cfg.BucketCerts,
	}, nil
}

func (b *cloudinaryBackend) EnsureBuckets(_ context.Context) error {
	return nil // Cloudinary folders are created on first upload
}

func (b *cloudinaryBackend) UploadAsset(ctx context.Context, objectKey string, r io.Reader, size int64, contentType string) (string, error) {
	return b.upload(ctx, objectKey, r, b.bucketAssets, contentType)
}

func (b *cloudinaryBackend) UploadCertificate(ctx context.Context, objectKey string, r io.Reader, size int64, contentType string) (string, error) {
	return b.upload(ctx, objectKey, r, b.bucketCerts, contentType)
}

func (b *cloudinaryBackend) upload(ctx context.Context, objectKey string, r io.Reader, folder, contentType string) (string, error) {
	data, err := io.ReadAll(r)
	if err != nil {
		return "", fmt.Errorf("cloudinary: read body: %w", err)
	}

	timestamp := strconv.FormatInt(time.Now().Unix(), 10)
	// Embed the full path (bucket + objectKey) in public_id, WITHOUT the file extension.
	// Cloudinary records the format (jpg, png, …) internally from the uploaded file content.
	// Including the extension in public_id causes it to appear twice in the delivery URL (.jpg.jpg).
	// Do NOT pass a separate "folder" param — combining it with a slashed public_id is ambiguous.
	keyWithoutExt := strings.TrimSuffix(strings.TrimSuffix(objectKey, "/"), filepath.Ext(objectKey))
	publicID := folder + "/" + keyWithoutExt

	// Build signature: alphabetically-sorted params + api_secret
	params := map[string]string{
		"public_id": publicID,
		"timestamp": timestamp,
	}
	sig := b.sign(params)

	// Build multipart body
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)

	fw, err := mw.CreateFormFile("file", objectKey)
	if err != nil {
		return "", fmt.Errorf("cloudinary: create form file: %w", err)
	}
	if _, err = fw.Write(data); err != nil {
		return "", fmt.Errorf("cloudinary: write file to form: %w", err)
	}

	for k, v := range params {
		if err := mw.WriteField(k, v); err != nil {
			return "", fmt.Errorf("cloudinary: write field %s: %w", k, err)
		}
	}
	_ = mw.WriteField("api_key", b.apiKey)
	_ = mw.WriteField("signature", sig)
	mw.Close()

	endpoint := fmt.Sprintf("https://api.cloudinary.com/v1_1/%s/auto/upload", b.cloudName)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, &buf)
	if err != nil {
		return "", fmt.Errorf("cloudinary: create request: %w", err)
	}
	req.Header.Set("Content-Type", mw.FormDataContentType())

	resp, err := b.httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("cloudinary: upload request: %w", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 400 {
		return "", fmt.Errorf("cloudinary: upload failed (%d): %s", resp.StatusCode, string(body))
	}

	var result struct {
		SecureURL string `json:"secure_url"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return "", fmt.Errorf("cloudinary: parse response: %w", err)
	}
	return result.SecureURL, nil
}

// sign produces a SHA-1 HMAC signature over alphabetically sorted params.
func (b *cloudinaryBackend) sign(params map[string]string) string {
	keys := make([]string, 0, len(params))
	for k := range params {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	parts := make([]string, 0, len(keys))
	for _, k := range keys {
		parts = append(parts, k+"="+params[k])
	}
	toSign := strings.Join(parts, "&") + b.apiSecret

	h := sha1.New()
	h.Write([]byte(toSign))
	return fmt.Sprintf("%x", h.Sum(nil))
}

func (b *cloudinaryBackend) GetAssetURL(objectKey string) string {
	// Cloudinary classifies font files as "raw" resource type (not "image").
	// Use the correct delivery resource type based on the object key extension.
	ext := strings.ToLower(filepath.Ext(objectKey))
	resourceType := "image"
	switch ext {
	case ".ttf", ".otf", ".woff", ".woff2":
		resourceType = "raw"
	}
	// Strip extension: public_id was stored without it (see upload).
	keyWithoutExt := strings.TrimSuffix(objectKey, filepath.Ext(objectKey))
	// For raw resources (fonts), Cloudinary requires the format extension in the
	// delivery URL; omitting it returns 404. Images work without an extension.
	if resourceType == "raw" {
		return fmt.Sprintf("https://res.cloudinary.com/%s/%s/upload/%s/%s%s", b.cloudName, resourceType, b.bucketAssets, keyWithoutExt, ext)
	}
	return fmt.Sprintf("https://res.cloudinary.com/%s/%s/upload/%s/%s", b.cloudName, resourceType, b.bucketAssets, keyWithoutExt)
}

func (b *cloudinaryBackend) GetCertURL(objectKey string) string {
	keyWithoutExt := strings.TrimSuffix(objectKey, filepath.Ext(objectKey))
	return fmt.Sprintf("https://res.cloudinary.com/%s/image/upload/%s/%s", b.cloudName, b.bucketCerts, keyWithoutExt)
}

func (b *cloudinaryBackend) GetObject(ctx context.Context, bucket, objectKey string) (io.ReadCloser, error) {
	var urlStr string
	if bucket == b.bucketAssets {
		urlStr = b.GetAssetURL(objectKey)
	} else {
		urlStr = b.GetCertURL(objectKey)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, urlStr, nil)
	if err != nil {
		return nil, fmt.Errorf("cloudinary: create download request: %w", err)
	}
	resp, err := b.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("cloudinary: download: %w", err)
	}
	if resp.StatusCode >= 400 {
		resp.Body.Close()
		return nil, fmt.Errorf("cloudinary: download failed (%d)", resp.StatusCode)
	}
	return resp.Body, nil
}

func (b *cloudinaryBackend) BucketAssets() string { return b.bucketAssets }
func (b *cloudinaryBackend) BucketCerts() string  { return b.bucketCerts }

func (b *cloudinaryBackend) DeleteObject(ctx context.Context, bucket, objectKey string) error {
	// Determine resource type: fonts are stored as "raw" in Cloudinary.
	ext := strings.ToLower(filepath.Ext(objectKey))
	resourceType := "image"
	switch ext {
	case ".ttf", ".otf", ".woff", ".woff2":
		resourceType = "raw"
	}

	keyWithoutExt := strings.TrimSuffix(objectKey, filepath.Ext(objectKey))
	publicID := bucket + "/" + keyWithoutExt

	timestamp := strconv.FormatInt(time.Now().Unix(), 10)
	params := map[string]string{
		"public_id":     publicID,
		"resource_type": resourceType,
		"timestamp":     timestamp,
	}
	sig := b.sign(params)

	var formBuf bytes.Buffer
	mw := multipart.NewWriter(&formBuf)
	_ = mw.WriteField("public_id", publicID)
	_ = mw.WriteField("resource_type", resourceType)
	_ = mw.WriteField("timestamp", timestamp)
	_ = mw.WriteField("api_key", b.apiKey)
	_ = mw.WriteField("signature", sig)
	mw.Close()

	endpoint := fmt.Sprintf("https://api.cloudinary.com/v1_1/%s/%s/destroy", b.cloudName, resourceType)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, &formBuf)
	if err != nil {
		return fmt.Errorf("cloudinary: delete request: %w", err)
	}
	req.Header.Set("Content-Type", mw.FormDataContentType())

	resp, err := b.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("cloudinary: delete: %w", err)
	}
	defer resp.Body.Close()
	// Cloudinary returns {"result":"ok"} or {"result":"not found"} — both are fine.
	return nil
}
