package worker

import (
	"context"
	"fmt"
	"image"
	"image/color"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"log"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/tdewolff/canvas"
	"github.com/tdewolff/canvas/renderers/rasterizer"
	xdraw "golang.org/x/image/draw"
	"golang.org/x/image/font/gofont/gobold"
	"golang.org/x/image/font/gofont/gobolditalic"
	"golang.org/x/image/font/gofont/goitalic"
	"golang.org/x/image/font/gofont/goregular"

	"github.com/skip2/go-qrcode"
	tmpl "github.com/gdgoc/admin-api/internal/domain/templates"
	"github.com/gdgoc/admin-api/internal/storage"
)

var (
	defaultFontRegular    *canvas.Font
	defaultFontBold       *canvas.Font
	defaultFontItalic     *canvas.Font
	defaultFontBoldItalic *canvas.Font
	defaultFontOnce       sync.Once
)

func initFonts() {
	defaultFontOnce.Do(func() {
		if f, err := canvas.LoadFont(goregular.TTF, 0, canvas.FontRegular); err == nil {
			defaultFontRegular = f
		}
		if f, err := canvas.LoadFont(gobold.TTF, 0, canvas.FontBold); err == nil {
			defaultFontBold = f
		}
		if f, err := canvas.LoadFont(goitalic.TTF, 0, canvas.FontItalic); err == nil {
			defaultFontItalic = f
		}
		if f, err := canvas.LoadFont(gobolditalic.TTF, 0, canvas.FontBold|canvas.FontItalic); err == nil {
			defaultFontBoldItalic = f
		}
	})
}

// ImageRenderer renders a SceneDefinition directly to an image.Image
// using tdewolff/canvas for 2D drawing and Go's built-in gofont for text.
// No SVG intermediate is produced.
type ImageRenderer struct {
	store      storage.Backend
	fontsDir   string
	fontsMu    sync.RWMutex
	fontsCache map[string]*canvas.Font
	imagesMu   sync.RWMutex
	imagesCache map[string]image.Image // keyed by asset key; avoids re-fetching from remote storage
}

func NewImageRenderer(store storage.Backend) *ImageRenderer {
	initFonts()
	fontsDir := os.Getenv("FONTS_DIR")
	if fontsDir == "" {
		fontsDir = "./data/fonts"
	}
	log.Printf("[font] fonts dir: %s", fontsDir)
	return &ImageRenderer{
		store:       store,
		fontsDir:    fontsDir,
		fontsCache:  make(map[string]*canvas.Font),
		imagesCache: make(map[string]image.Image),
	}
}

// cachedImage returns a decoded image.Image for the given asset key, fetching
// and caching it on first access. Returns nil on any error.
func (r *ImageRenderer) cachedImage(ctx context.Context, assetKey string) image.Image {
	r.imagesMu.RLock()
	if img, ok := r.imagesCache[assetKey]; ok {
		r.imagesMu.RUnlock()
		return img
	}
	r.imagesMu.RUnlock()

	rc, err := r.store.GetObject(ctx, r.store.BucketAssets(), assetKey)
	if err != nil {
		return nil
	}
	defer rc.Close()
	img, _, err := image.Decode(rc)
	if err != nil {
		return nil
	}

	r.imagesMu.Lock()
	r.imagesCache[assetKey] = img
	r.imagesMu.Unlock()
	return img
}

// resolveFont returns a *canvas.Font for the given family name, weight and italic.
// weight is a CSS font-weight value (100–900); 400 = regular, 700 = bold.
// It first tries to load from the fonts directory, then falls back to the
// embedded Go fonts.
// fontFamilyAliases maps font families that are unavailable on Linux/Google Fonts
// to their closest freely-available substitute.
var fontFamilyAliases = map[string]string{
	"Helvetica":        "Arial",
	"Helvetica Neue":   "Arial",
	"Times":            "Times New Roman",
	"Courier":          "Courier New",
}

func (r *ImageRenderer) resolveFont(family string, weight int, italic bool) *canvas.Font {
	if family == "" {
		return r.defaultFont(weight, italic)
	}
	if alias, ok := fontFamilyAliases[family]; ok {
		family = alias
	}
	key := fmt.Sprintf("%s|%d|%v", family, weight, italic)
	r.fontsMu.RLock()
	if f, ok := r.fontsCache[key]; ok {
		r.fontsMu.RUnlock()
		return f
	}
	r.fontsMu.RUnlock()

	style := fontWeightToStyle(weight, italic)
	var f *canvas.Font

	data := r.loadFontBytesFromDir(family, weight, italic)
	if data != nil {
		var err error
		if f, err = canvas.LoadFont(data, 0, style); err != nil {
			log.Printf("canvas.LoadFont %q: %v – using fallback font", family, err)
			f = r.defaultFont(weight, italic)
		}
	} else {
		// Fall back to Google Fonts download, cache the TTF to disk for next time
		if downloaded, err := downloadGoogleFontBytes(family, weight, italic, r.fontsDir); err == nil {
			if f, err = canvas.LoadFont(downloaded, 0, style); err != nil {
				log.Printf("canvas.LoadFont after download %q: %v – using fallback", family, err)
				f = r.defaultFont(weight, italic)
			}
		} else {
			log.Printf("google fonts download %q: %v – using fallback font", family, err)
			f = r.defaultFont(weight, italic)
		}
	}

	r.fontsMu.Lock()
	r.fontsCache[key] = f
	r.fontsMu.Unlock()
	return f
}

func fontWeightToStyle(weight int, italic bool) canvas.FontStyle {
	var style canvas.FontStyle
	switch {
	case weight <= 100:
		style = canvas.FontThin
	case weight <= 200:
		style = canvas.FontExtraLight
	case weight <= 300:
		style = canvas.FontLight
	case weight <= 400:
		style = canvas.FontRegular
	case weight <= 500:
		style = canvas.FontMedium
	case weight <= 600:
		style = canvas.FontSemiBold
	case weight <= 700:
		style = canvas.FontBold
	case weight <= 800:
		style = canvas.FontExtraBold
	default:
		style = canvas.FontBlack
	}
	if italic {
		style |= canvas.FontItalic
	}
	return style
}

// fontWeightSuffix returns the conventional TTF filename suffix for a given weight/italic pair.
func fontWeightSuffix(weight int, italic bool) string {
	var w string
	switch {
	case weight <= 100:
		w = "Thin"
	case weight <= 200:
		w = "ExtraLight"
	case weight <= 300:
		w = "Light"
	case weight <= 400:
		w = "Regular"
	case weight <= 500:
		w = "Medium"
	case weight <= 600:
		w = "SemiBold"
	case weight <= 700:
		w = "Bold"
	case weight <= 800:
		w = "ExtraBold"
	default:
		w = "Black"
	}
	if italic {
		if w == "Regular" {
			return "-Italic"
		}
		return "-" + w + "Italic"
	}
	return "-" + w
}

// downloadGoogleFontBytes fetches a TTF directly from the Google Fonts CSS API
// and returns the raw font bytes. Using an Android mobile User-Agent causes the
// API to respond with direct .ttf URLs instead of woff2/eot containers.
func downloadGoogleFontBytes(family string, weight int, italic bool, cacheDir string) ([]byte, error) {
	variant := fmt.Sprintf("%d", weight)
	if italic {
		variant += "i"
	}

	apiURL := fmt.Sprintf(
		"https://fonts.googleapis.com/css?family=%s:%s",
		strings.ReplaceAll(family, " ", "+"), variant,
	)
	const androidUA = "Mozilla/5.0 (Linux; U; Android 2.2; en-us; Nexus One Build/FRF91) AppleWebKit/533.1 (KHTML, like Gecko) Version/4.0 Mobile Safari/533.1"
	client := &http.Client{Timeout: 15 * time.Second}

	req, err := http.NewRequestWithContext(context.Background(), http.MethodGet, apiURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", androidUA)

	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("google fonts CSS API status %d for %q", resp.StatusCode, family)
	}

	css, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	// Match any truetype src URL — Google CDN URLs no longer end in .ttf.
	// Matches: url(https://...) format('truetype')
	re := regexp.MustCompile(`url\((https://[^)]+)\)\s+format\('truetype'\)`)
	m := re.FindSubmatch(css)
	if m == nil {
		return nil, fmt.Errorf("no truetype URL in CSS for %q variant %q", family, variant)
	}
	ttfURL := string(m[1])

	fontReq, err := http.NewRequestWithContext(context.Background(), http.MethodGet, ttfURL, nil)
	if err != nil {
		return nil, err
	}
	fontReq.Header.Set("User-Agent", androidUA)
	fontResp, err := client.Do(fontReq)
	if err != nil {
		return nil, fmt.Errorf("font download: %w", err)
	}
	defer fontResp.Body.Close()
	if fontResp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("font download status %d for %q", fontResp.StatusCode, family)
	}

	fontData, err := io.ReadAll(fontResp.Body)
	if err != nil {
		return nil, err
	}

	if cacheDir != "" {
		suffix := fontWeightSuffix(weight, italic)
		name := strings.ReplaceAll(family, " ", "") + suffix + ".ttf"
		dest := filepath.Join(cacheDir, name)
		if werr := os.WriteFile(dest, fontData, 0600); werr != nil {
			log.Printf("[font] cache write failed for %q: %v", family, werr)
		} else {
			log.Printf("[font] cached %q to %s", family, dest)
		}
	}

	return fontData, nil
}

// loadFontBytesFromDir tries common naming conventions for TTF font files under
// r.fontsDir. Returns nil if no matching file is found.
func (r *ImageRenderer) loadFontBytesFromDir(family string, weight int, italic bool) []byte {
	suffix := fontWeightSuffix(weight, italic)

	noSpace := strings.ReplaceAll(family, " ", "")
	candidates := []string{
		family + suffix + ".ttf",
		noSpace + suffix + ".ttf",
		strings.ReplaceAll(family, " ", "-") + suffix + ".ttf",
	}
	// For regular weight, also try bare family name
	if suffix == "-Regular" {
		candidates = append(candidates, family+".ttf", noSpace+".ttf")
	}

	for _, name := range candidates {
		p := filepath.Join(r.fontsDir, name)
		data, err := os.ReadFile(p)
		if err != nil {
			log.Printf("[font] miss: %s", p)
			continue
		}
		log.Printf("[font] hit: %s", p)
		return data
	}
	return nil
}

// loadFontFromStorage downloads a font file by asset key from the storage
// backend, caches the parsed font in memory (keyed by asset key), and
// persists the raw bytes to fontsDir so future process restarts skip the
// network round-trip.
func (r *ImageRenderer) loadFontFromStorage(ctx context.Context, assetKey string) *canvas.Font {
	r.fontsMu.RLock()
	if f, ok := r.fontsCache["asset:"+assetKey]; ok {
		r.fontsMu.RUnlock()
		return f
	}
	r.fontsMu.RUnlock()

	rc, err := r.store.GetObject(ctx, r.store.BucketAssets(), assetKey)
	if err != nil {
		log.Printf("font asset %q not found in storage: %v", assetKey, err)
		return nil
	}
	defer rc.Close()

	data, err := io.ReadAll(rc)
	if err != nil {
		log.Printf("font asset %q read error: %v", assetKey, err)
		return nil
	}

	f, err := canvas.LoadFont(data, 0, canvas.FontRegular)
	if err != nil {
		log.Printf("font asset %q parse error: %v", assetKey, err)
		return nil
	}

	// Persist to fontsDir so the file is available on next startup
	if r.fontsDir != "" {
		name := filepath.Base(assetKey)
		if err := os.WriteFile(filepath.Join(r.fontsDir, name), data, 0600); err != nil {
			log.Printf("font asset cache write: %v", err)
		}
	}

	r.fontsMu.Lock()
	r.fontsCache["asset:"+assetKey] = f
	r.fontsMu.Unlock()
	return f
}

func (r *ImageRenderer) defaultFont(weight int, italic bool) *canvas.Font {
	bold := weight >= 700
	switch {
	case bold && italic:
		return defaultFontBoldItalic
	case bold:
		return defaultFontBold
	case italic:
		return defaultFontItalic
	default:
		return defaultFontRegular
	}
}

func (r *ImageRenderer) Render(ctx context.Context, scene tmpl.SceneDefinition, vars map[string]string) (image.Image, error) {
	return r.render(ctx, scene, vars, false)
}

// RenderBackground renders all layers except dynamic text, producing the raster
// base for the hybrid PDF (where dynamic text is drawn as real PDF text on top).
func (r *ImageRenderer) RenderBackground(ctx context.Context, scene tmpl.SceneDefinition, vars map[string]string) (image.Image, error) {
	return r.render(ctx, scene, vars, true)
}

func (r *ImageRenderer) render(ctx context.Context, scene tmpl.SceneDefinition, vars map[string]string, skipDynamicText bool) (image.Image, error) {
	w := int(scene.Width)
	h := int(scene.Height)
	if w <= 0 {
		w = 1200
	}
	if h <= 0 {
		h = 848
	}

	// Create canvas with pixel dimensions (1 canvas unit = 1 pixel at DPMM 1.0).
	// Canvas uses CartesianI by default (origin bottom-left, Y up).
	// All drawing helpers convert screen coords (origin top-left, Y down) using flipY.
	c := canvas.New(float64(w), float64(h))
	dc := canvas.NewContext(c)

	r.drawBackground(ctx, dc, scene.Background, w, h)

	layers := make([]tmpl.Layer, len(scene.Layers))
	copy(layers, scene.Layers)
	sortLayersByZ(layers) // defined in svg_renderer.go (same package)

	for _, layer := range layers {
		if !layer.Visible {
			continue
		}
		switch layer.Type {
		case tmpl.LayerTypeText:
			if skipDynamicText && layer.TextProps != nil && (layer.TextProps.IsDynamic || layer.TextProps.ScriptSource != "") {
				continue
			}
			if err := r.drawText(ctx, dc, layer, vars, float64(h)); err != nil {
				return nil, err
			}
		case tmpl.LayerTypeImage:
			r.drawImageLayer(ctx, dc, layer, float64(h))
		case tmpl.LayerTypeShape:
			r.drawShape(dc, layer, float64(h))
		case tmpl.LayerTypeQR:
			r.drawQrLayer(dc, layer, vars, float64(h))
		}
	}

	// Render at 1 pixel per canvas unit (DPMM 1.0 → output is w×h pixels).
	return rasterizer.Draw(c, canvas.DPMM(1.0), canvas.DefaultColorSpace), nil
}

// flipY converts a screen Y coordinate (origin top-left, Y down) to the
// canvas math Y coordinate (origin bottom-left, Y up).
func flipY(canvasH, screenY float64) float64 {
	return canvasH - screenY
}

func (r *ImageRenderer) drawBackground(ctx context.Context, dc *canvas.Context, bg string, w, h int) {
	fw, fh := float64(w), float64(h)
	if bg == "" || strings.HasPrefix(bg, "#") {
		dc.Push()
		dc.SetFillColor(parseHexColor(bg))
		dc.SetStrokeColor(color.RGBA{})
		dc.DrawPath(0, 0, canvas.Rectangle(fw, fh))
		dc.Pop()
		return
	}
	// Treat as asset key
	if img := r.cachedImage(ctx, bg); img != nil {
		fitted := fitImage(img, w, h, "fill")
		imgH := float64(fitted.Bounds().Dy())
		dc.DrawImage(0, fh-imgH, fitted, canvas.DPMM(1.0))
		return
	}
	dc.Push()
	dc.SetFillColor(color.White)
	dc.SetStrokeColor(color.RGBA{})
	dc.DrawPath(0, 0, canvas.Rectangle(fw, fh))
	dc.Pop()
}

func (r *ImageRenderer) drawText(ctx context.Context, dc *canvas.Context, layer tmpl.Layer, vars map[string]string, h float64) error {
	if layer.TextProps == nil {
		return nil
	}
	p := layer.TextProps
	content := resolveTextContent(p, vars)
	switch p.TextTransform {
	case "uppercase":
		content = strings.ToUpper(content)
	case "lowercase":
		content = strings.ToLower(content)
	case "capitalize":
		content = capitalizeWords(content)
	}

	// Resolve font: explicit asset key > font_family (local dir / Google Fonts) > embedded fallback
	// FontWeight (100–900) takes priority over the legacy Bold bool.
	weight := p.FontWeight
	if weight == 0 {
		if p.Bold {
			weight = 700
		} else {
			weight = 400
		}
	}

	var cf *canvas.Font
	if p.FontAssetKey != "" {
		cf = r.loadFontFromStorage(ctx, p.FontAssetKey)
	}
	if cf == nil {
		cf = r.resolveFont(p.FontFamily, weight, p.Italic)
	}
	if cf == nil {
		cf = defaultFontRegular
	}
	if cf == nil {
		return nil
	}

	textColor := parseHexColor(p.Color)
	// canvas.Font.Face() takes size in points; internally it multiplies by mmPerPt (25.4/72).
	// Our coordinate system is 1 canvas unit = 1 pixel (canvas.New(w,h) at DPMM(1.0)).
	// p.FontSize is in pixels, so we convert: pixels → points by multiplying by 72/25.4.
	const pxToPt = 72.0 / 25.4
	face := cf.Face(p.FontSize*pxToPt, textColor)

	dc.Push()
	defer dc.Pop()

	if layer.Rotation != 0 {
		// layer.Rotation is in degrees; canvas RotateAbout also takes degrees.
		// Rotation center is the layer's center in screen coords → flip Y for math coords.
		dc.RotateAbout(layer.Rotation, layer.X, flipY(h, layer.Y))
	}

	// Top-left corner of the layer bounding box (screen coords)
	boxLeft := layer.X - layer.Width/2
	boxTop := layer.Y - layer.Height/2

	dc.SetFillColor(textColor)
	dc.SetStrokeColor(color.RGBA{})

	var halign canvas.TextAlign
	switch p.Align {
	case "center":
		halign = canvas.Center
	case "right":
		halign = canvas.Right
	default:
		halign = canvas.Left
	}

	// Fixed-width mode: auto_width is explicitly false (user locked the box size).
	// Fall back to layer.Width > 0 for legacy data that predates the auto_width field.
	fixedWidth := (p.AutoWidth != nil && !*p.AutoWidth) || (p.AutoWidth == nil && layer.Width > 0)

	if fixedWidth {
		// Word-wrapped text block.
		// RichText.ToText lays out text within the given width.
		// DrawText in CartesianI places the FIRST LINE BASELINE at (tx, ty) in math coords.
		// boxTop (screen) → math y = h - boxTop (baseline of first line at top of box).
		rt := canvas.NewRichText(face)
		rt.WriteFace(face, content)
		text := rt.ToText(layer.Width, 0, halign, canvas.Top, nil)
		dc.DrawText(boxLeft, flipY(h, boxTop), text)
	} else {
		// No fixed width: single-line, no wrapping.
		textLine := canvas.NewTextLine(face, content, canvas.Left)

		var tx float64
		switch p.Align {
		case "center":
			tx = layer.X - textLine.Width/2
		case "right":
			tx = layer.X - textLine.Width
		default:
			tx = layer.X
		}
		// Baseline at math y = h - (boxTop + p.FontSize)
		dc.DrawText(tx, flipY(h, boxTop+p.FontSize), textLine)
	}
	return nil
}

func (r *ImageRenderer) drawImageLayer(ctx context.Context, dc *canvas.Context, layer tmpl.Layer, h float64) {
	if layer.ImageProps == nil {
		return
	}
	img := r.cachedImage(ctx, layer.ImageProps.AssetKey)
	if img == nil {
		return
	}

	scaled := fitImage(img, int(layer.Width), int(layer.Height), layer.ImageProps.ObjectFit)

	dc.Push()
	defer dc.Pop()

	if layer.Rotation != 0 {
		dc.RotateAbout(layer.Rotation, layer.X, flipY(h, layer.Y))
	}

	imgH := float64(scaled.Bounds().Dy())
	// Image top-left in screen coords → bottom-left in canvas math coords.
	x := layer.X - layer.Width/2
	y := layer.Y - layer.Height/2
	dc.DrawImage(x, flipY(h, y)-imgH, scaled, canvas.DPMM(1.0))
}

// drawQrLayer generates a QR code and draws it like an image layer.
// Content supports {{variable}} interpolation.
func (r *ImageRenderer) drawQrLayer(dc *canvas.Context, layer tmpl.Layer, vars map[string]string, h float64) {
	if layer.QrProps == nil {
		return
	}
	qp := layer.QrProps

	// Resolve content — interpolate {{variable}} tokens.
	content := Interpolate(qp.Content, vars)
	if content == "" {
		content = "https://example.com"
	}

	// Map error-correction level string → go-qrcode constant.
	var ecLevel qrcode.RecoveryLevel
	switch strings.ToUpper(qp.ErrorCorrection) {
	case "L":
		ecLevel = qrcode.Low
	case "Q":
		ecLevel = qrcode.High // go-qrcode has no "Q"; map to High
	case "H":
		ecLevel = qrcode.Highest
	default: // "M" or empty
		ecLevel = qrcode.Medium
	}

	qr, err := qrcode.New(content, ecLevel)
	if err != nil {
		log.Printf("QR encode error for layer %q: %v", layer.ID, err)
		return
	}
	qr.DisableBorder = true

	// Apply colours from props; go-qrcode handles the pixel mapping natively.
	if qp.ColorDark != "" {
		qr.ForegroundColor = parseHexColor(qp.ColorDark)
	}
	if qp.ColorLight != "" {
		qr.BackgroundColor = parseHexColor(qp.ColorLight)
	}

	// Render at the layer's pixel size (minimum 64 px).
	size := int(math.Max(layer.Width, 64))
	img := qr.Image(size)

	// Scale to exactly fill the layer bounding box.
	target := int(math.Max(layer.Width, layer.Height))
	scaled := fitImage(img, target, target, "fill")

	dc.Push()
	defer dc.Pop()

	if layer.Rotation != 0 {
		dc.RotateAbout(layer.Rotation, layer.X, flipY(h, layer.Y))
	}

	imgH2 := float64(scaled.Bounds().Dy())
	x := layer.X - layer.Width/2
	y := layer.Y - layer.Height/2
	dc.DrawImage(x, flipY(h, y)-imgH2, scaled, canvas.DPMM(1.0))
}

func (r *ImageRenderer) drawShape(dc *canvas.Context, layer tmpl.Layer, h float64) {
	if layer.ShapeProps == nil {
		return
	}
	sp := layer.ShapeProps

	dc.Push()
	defer dc.Pop()

	if layer.Rotation != 0 {
		dc.RotateAbout(layer.Rotation, layer.X, flipY(h, layer.Y))
	}

	ox := layer.X - layer.Width/2
	oy := layer.Y - layer.Height/2

	hasFill := sp.Fill != nil
	hasStroke := sp.StrokeWidth > 0 && sp.StrokeColor != ""

	if !hasFill && !hasStroke {
		return
	}

	if hasFill {
		dc.SetFillColor(shapeColor(sp.Fill))
	} else {
		dc.SetFillColor(color.RGBA{})
	}
	if hasStroke {
		dc.SetStrokeColor(parseHexColor(sp.StrokeColor))
		dc.SetStrokeWidth(sp.StrokeWidth)
	} else {
		dc.SetStrokeColor(color.RGBA{})
	}

	switch sp.Kind {
	case "rect":
		var p *canvas.Path
		if sp.CornerRadius > 0 {
			p = canvas.RoundedRectangle(layer.Width, layer.Height, sp.CornerRadius)
		} else {
			p = canvas.Rectangle(layer.Width, layer.Height)
		}
		// Rect bottom-left in math coords: (ox, h - oy - layer.Height)
		dc.DrawPath(ox, flipY(h, oy)-layer.Height, p)
	case "circle":
		// Ellipse is centered at its origin; place at layer center in math coords.
		dc.DrawPath(layer.X, flipY(h, layer.Y), canvas.Ellipse(layer.Width/2, layer.Height/2))
	case "line":
		// Horizontal line from ox to ox+layer.Width at screen y=layer.Y.
		dc.DrawPath(ox, flipY(h, layer.Y), canvas.Line(layer.Width, 0))
	case "path":
		if sp.PathProps != nil {
			dc.DrawPath(0, 0, buildBezierPath(sp.PathProps, ox, oy, h))
		}
	}
}

// buildBezierPath constructs a *canvas.Path from PathProps, converting screen
// coordinates (Y-down) to canvas math coordinates (Y-up).
func buildBezierPath(pp *tmpl.PathProps, ox, oy, h float64) *canvas.Path {
	p := &canvas.Path{}
	for _, sub := range pp.Subpaths {
		if len(sub.Anchors) == 0 {
			continue
		}
		a0 := sub.Anchors[0]
		p.MoveTo(ox+a0.X, flipY(h, oy+a0.Y))
		for i := 1; i < len(sub.Anchors); i++ {
			prev := sub.Anchors[i-1]
			curr := sub.Anchors[i]
			p.CubeTo(
				ox+prev.X+prev.HoX, flipY(h, oy+prev.Y+prev.HoY),
				ox+curr.X+curr.HiX, flipY(h, oy+curr.Y+curr.HiY),
				ox+curr.X, flipY(h, oy+curr.Y),
			)
		}
		if sub.Closed && len(sub.Anchors) > 1 {
			last := sub.Anchors[len(sub.Anchors)-1]
			first := sub.Anchors[0]
			p.CubeTo(
				ox+last.X+last.HoX, flipY(h, oy+last.Y+last.HoY),
				ox+first.X+first.HiX, flipY(h, oy+first.Y+first.HiY),
				ox+first.X, flipY(h, oy+first.Y),
			)
			p.Close()
		}
	}
	return p
}

// fitImage scales src to (w,h) using the given object-fit mode.
func fitImage(src image.Image, w, h int, fit string) image.Image {
	sb := src.Bounds()
	srcW, srcH := sb.Dx(), sb.Dy()
	if srcW == w && srcH == h {
		return src
	}

	var dstRect, srcRect image.Rectangle

	switch fit {
	case "fill":
		dstRect = image.Rect(0, 0, w, h)
		srcRect = sb
	case "contain":
		scale := math.Min(float64(w)/float64(srcW), float64(h)/float64(srcH))
		nw := int(float64(srcW) * scale)
		nh := int(float64(srcH) * scale)
		dstRect = image.Rect(0, 0, nw, nh)
		srcRect = sb
	default: // cover
		scale := math.Max(float64(w)/float64(srcW), float64(h)/float64(srcH))
		nw := int(float64(srcW) * scale)
		nh := int(float64(srcH) * scale)
		cropX := (nw - w) / 2
		cropY := (nh - h) / 2
		sx := float64(srcW) / float64(nw)
		sy := float64(srcH) / float64(nh)
		dstRect = image.Rect(0, 0, w, h)
		srcRect = image.Rect(
			int(float64(cropX)*sx), int(float64(cropY)*sy),
			int(float64(cropX+w)*sx), int(float64(cropY+h)*sy),
		)
	}

	dst := image.NewRGBA(dstRect)
	xdraw.BiLinear.Scale(dst, dstRect, src, srcRect, xdraw.Over, nil)
	return dst
}

// shapeColor returns the effective fill color; gradients fall back to their first stop.
func shapeColor(fill *tmpl.ShapeFill) color.Color {
	switch fill.Type {
	case "solid":
		return parseHexColor(fill.Color)
	case "linear", "radial":
		if len(fill.Stops) > 0 {
			return parseHexColor(fill.Stops[0].Color)
		}
	}
	return color.Transparent
}

// capitalizeWords title-cases every word in s (first letter upper, rest lower).
func capitalizeWords(s string) string {
	words := strings.Fields(s)
	for i, w := range words {
		if len(w) == 0 {
			continue
		}
		words[i] = strings.ToUpper(w[:1]) + strings.ToLower(w[1:])
	}
	return strings.Join(words, " ")
}

// parseHexColor parses #RGB, #RRGGBB, or #RRGGBBAA into color.RGBA.
func parseHexColor(s string) color.RGBA {
	s = strings.TrimPrefix(s, "#")
	if s == "" {
		return color.RGBA{R: 255, G: 255, B: 255, A: 255} // white default
	}
	n, err := strconv.ParseUint(s, 16, 32)
	if err != nil {
		return color.RGBA{A: 255}
	}
	switch len(s) {
	case 3:
		r := uint8((n>>8)&0xF) * 17
		g := uint8((n>>4)&0xF) * 17
		b := uint8(n&0xF) * 17
		return color.RGBA{R: r, G: g, B: b, A: 255}
	case 6:
		return color.RGBA{R: uint8(n >> 16), G: uint8(n >> 8), B: uint8(n), A: 255}
	case 8:
		return color.RGBA{R: uint8(n >> 24), G: uint8(n >> 16), B: uint8(n >> 8), A: uint8(n)}
	}
	return color.RGBA{A: 255}
}
