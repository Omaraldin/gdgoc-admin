package worker

import (
	"bytes"
	"context"
	"fmt"
	"image"
	"image/color"
	stdDraw "image/draw"
	"image/jpeg"
	"image/png"
	"log"

	tmpl "github.com/gdgoc/admin-api/internal/domain/templates"
	"github.com/gdgoc/admin-api/internal/storage"
	"github.com/phpdave11/gofpdf"
)

// Converter uploads rendered certificates to object storage.
type Converter struct {
	store storage.Backend
}

func NewConverter(store storage.Backend) *Converter {
	return &Converter{store: store}
}

// ToPDF embeds bgImg as a full-page JPEG inside a PDF.
// textLayers and vars are accepted for API compatibility but selectable-text
// overlay is not yet rendered (the visual text is already rasterised in bgImg).
func (c *Converter) ToPDF(_ context.Context, bgImg image.Image, _ []tmpl.Layer, _ map[string]string, objectKey string) error {
	// Flatten alpha → opaque RGB before JPEG encoding.
	flat := flattenToRGB(bgImg)
	var jpgBuf bytes.Buffer
	if err := jpeg.Encode(&jpgBuf, flat, &jpeg.Options{Quality: 95}); err != nil {
		return fmt.Errorf("jpeg encode: %w", err)
	}
	log.Printf("converter ToPDF: jpeg=%d bytes key=%s", jpgBuf.Len(), objectKey)

	imgW := bgImg.Bounds().Dx()
	imgH := bgImg.Bounds().Dy()

	const dpi = 96.0
	const mmPerInch = 25.4
	wMM := float64(imgW) / dpi * mmPerInch
	hMM := float64(imgH) / dpi * mmPerInch

	pdf := gofpdf.NewCustom(&gofpdf.InitType{
		OrientationStr: "P",
		UnitStr:        "mm",
		Size:           gofpdf.SizeType{Wd: wMM, Ht: hMM},
	})
	pdf.SetMargins(0, 0, 0)
	pdf.SetAutoPageBreak(false, 0)
	pdf.AddPage()

	opts := gofpdf.ImageOptions{ImageType: "JPEG"}
	pdf.RegisterImageOptionsReader("bg", opts, bytes.NewReader(jpgBuf.Bytes()))
	pdf.ImageOptions("bg", 0, 0, wMM, hMM, false, opts, 0, "")

	if err := pdf.Error(); err != nil {
		return fmt.Errorf("gofpdf build: %w", err)
	}

	var pdfBuf bytes.Buffer
	if err := pdf.Output(&pdfBuf); err != nil {
		return fmt.Errorf("gofpdf output: %w", err)
	}
	log.Printf("converter ToPDF: pdf=%d bytes key=%s", pdfBuf.Len(), objectKey)

	r := bytes.NewReader(pdfBuf.Bytes())
	_, err := c.store.UploadCertificate(context.Background(), objectKey, r, int64(pdfBuf.Len()), "application/pdf")
	return err
}

// ToPDFBytes encodes img as a single-page PDF and returns the raw bytes.
// This is the non-uploading counterpart of ToPDF, used for on-demand rendering.
func ToPDFBytes(img image.Image) ([]byte, error) {
	flat := flattenToRGB(img)
	var jpgBuf bytes.Buffer
	if err := jpeg.Encode(&jpgBuf, flat, &jpeg.Options{Quality: 95}); err != nil {
		return nil, fmt.Errorf("jpeg encode: %w", err)
	}

	imgW := img.Bounds().Dx()
	imgH := img.Bounds().Dy()

	const dpi = 96.0
	const mmPerInch = 25.4
	wMM := float64(imgW) / dpi * mmPerInch
	hMM := float64(imgH) / dpi * mmPerInch

	pdf := gofpdf.NewCustom(&gofpdf.InitType{
		OrientationStr: "P",
		UnitStr:        "mm",
		Size:           gofpdf.SizeType{Wd: wMM, Ht: hMM},
	})
	pdf.SetMargins(0, 0, 0)
	pdf.SetAutoPageBreak(false, 0)
	pdf.AddPage()

	opts := gofpdf.ImageOptions{ImageType: "JPEG"}
	pdf.RegisterImageOptionsReader("bg", opts, bytes.NewReader(jpgBuf.Bytes()))
	pdf.ImageOptions("bg", 0, 0, wMM, hMM, false, opts, 0, "")

	if err := pdf.Error(); err != nil {
		return nil, fmt.Errorf("gofpdf build: %w", err)
	}

	var pdfBuf bytes.Buffer
	if err := pdf.Output(&pdfBuf); err != nil {
		return nil, fmt.Errorf("gofpdf output: %w", err)
	}
	return pdfBuf.Bytes(), nil
}

// ToPNG encodes img as PNG and uploads it.
func (c *Converter) ToPNG(ctx context.Context, img image.Image, objectKey string) error {
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		return fmt.Errorf("png encode: %w", err)
	}
	r := bytes.NewReader(buf.Bytes())
	_, err := c.store.UploadCertificate(ctx, objectKey, r, int64(buf.Len()), "image/png")
	return err
}

// flattenToRGB composites src over a solid white background and returns an
// opaque *image.RGBA (no alpha channel), safe for JPEG encoding.
func flattenToRGB(src image.Image) *image.RGBA {
	bounds := src.Bounds()
	dst := image.NewRGBA(bounds)
	// Fill with opaque white first
	stdDraw.Draw(dst, bounds, &image.Uniform{color.White}, image.Point{}, stdDraw.Src)
	// Composite source on top (respects src alpha)
	stdDraw.Draw(dst, bounds, src, bounds.Min, stdDraw.Over)
	return dst
}

func encodePNG(img image.Image) ([]byte, error) {
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}
