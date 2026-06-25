package issuance

import (
	"fmt"
	"os"
	"path/filepath"
)

// DiskCache persists rendered certificate files to a local directory so they
// survive process restarts and don't need to be recomputed on every request.
//
// Layout:
//
//	<baseDir>/png/<recipientID>.png
//	<baseDir>/pdf/<recipientID>.pdf
type DiskCache struct {
	baseDir string
}

// NewDiskCache creates a DiskCache rooted at baseDir and ensures the
// required sub-directories exist.
func NewDiskCache(baseDir string) (*DiskCache, error) {
	for _, sub := range []string{"png", "pdf"} {
		if err := os.MkdirAll(filepath.Join(baseDir, sub), 0o755); err != nil {
			return nil, fmt.Errorf("disk cache mkdir %s: %w", sub, err)
		}
	}
	return &DiskCache{baseDir: baseDir}, nil
}

// path returns the file path for a given recipient ID and format ("png"|"pdf").
func (c *DiskCache) path(recipientID, format string) string {
	return filepath.Join(c.baseDir, format, recipientID+"."+format)
}

// Get returns cached bytes for the recipient+format pair, or (nil, nil) if not cached.
func (c *DiskCache) Get(recipientID, format string) ([]byte, error) {
	data, err := os.ReadFile(c.path(recipientID, format))
	if os.IsNotExist(err) {
		return nil, nil
	}
	return data, err
}

// Put writes rendered bytes to disk, creating the file atomically via a temp
// file + rename so concurrent readers never see a partial write.
func (c *DiskCache) Put(recipientID, format string, data []byte) error {
	dest := c.path(recipientID, format)
	tmp := dest + ".tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return fmt.Errorf("disk cache write tmp: %w", err)
	}
	if err := os.Rename(tmp, dest); err != nil {
		os.Remove(tmp)
		return fmt.Errorf("disk cache rename: %w", err)
	}
	return nil
}

// Evict removes all cached formats (png + pdf) for a single recipient.
// Missing files are silently ignored.
func (c *DiskCache) Evict(recipientID string) {
	for _, format := range []string{"png", "pdf"} {
		_ = os.Remove(c.path(recipientID, format))
	}
}

// Purge deletes every file inside the png/ and pdf/ sub-directories,
// effectively clearing the entire cache. Called by the weekly cron job.
func (c *DiskCache) Purge() error {
	for _, sub := range []string{"png", "pdf"} {
		dir := filepath.Join(c.baseDir, sub)
		entries, err := os.ReadDir(dir)
		if err != nil {
			if os.IsNotExist(err) {
				continue
			}
			return fmt.Errorf("disk cache purge readdir %s: %w", sub, err)
		}
		for _, e := range entries {
			if err := os.Remove(filepath.Join(dir, e.Name())); err != nil && !os.IsNotExist(err) {
				return fmt.Errorf("disk cache purge remove %s: %w", e.Name(), err)
			}
		}
	}
	return nil
}
