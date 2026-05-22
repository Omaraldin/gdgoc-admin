package worker

import (
	"bytes"
	"fmt"
	"math"
	"strings"

	"github.com/skip2/go-qrcode"
	tmpl "github.com/gdgoc/admin-api/internal/domain/templates"
)

// SVGRenderer converts a SceneDefinition + variable map into an SVG byte slice.
// This is the canonical rendering step shared by PDF and PNG pipelines.
type SVGRenderer struct {
	defs      bytes.Buffer
	defsSeq   int
	printable bool // when true, all colors are CMYK-mapped before output
}

func NewSVGRenderer() *SVGRenderer { return &SVGRenderer{} }

func NewSVGRendererPrintable() *SVGRenderer { return &SVGRenderer{printable: true} }

// color maps a CSS color string through CMYK when printable mode is active.
func (r *SVGRenderer) color(c string) string {
	if !r.printable || c == "" || c == "none" || c == "transparent" {
		return c
	}
	return tmpl.MapColorPrintable(c)
}

func (r *SVGRenderer) nextDefID(prefix string) string {
	r.defsSeq++
	return fmt.Sprintf("%s_%d", prefix, r.defsSeq)
}

func (r *SVGRenderer) Render(scene tmpl.SceneDefinition, vars map[string]string) ([]byte, error) {
	r.defs.Reset()
	r.defsSeq = 0

	var body bytes.Buffer
	fmt.Fprintf(&body, `<rect width="100%%" height="100%%" fill="%s"/>`, escapeAttr(r.color(scene.Background)))

	// Sort layers by z_index ascending for correct paint order
	layers := make([]tmpl.Layer, len(scene.Layers))
	copy(layers, scene.Layers)
	sortLayersByZ(layers)

	for _, layer := range layers {
		if !layer.Visible {
			continue
		}
		switch layer.Type {
		case tmpl.LayerTypeText:
			if err := r.renderText(&body, layer, vars); err != nil {
				return nil, err
			}
		case tmpl.LayerTypeImage:
			r.renderImage(&body, layer)
		case tmpl.LayerTypeShape:
			r.renderShape(&body, layer)
		case tmpl.LayerTypeQR:
			r.renderQr(&body, layer, vars)
		}
	}

	var buf bytes.Buffer
	fmt.Fprintf(&buf, `<svg xmlns="http://www.w3.org/2000/svg" width="%.0f" height="%.0f">`, scene.Width, scene.Height)
	if r.defs.Len() > 0 {
		buf.WriteString(`<defs>`)
		buf.Write(r.defs.Bytes())
		buf.WriteString(`</defs>`)
	}
	buf.Write(body.Bytes())
	buf.WriteString(`</svg>`)
	return buf.Bytes(), nil
}

func (r *SVGRenderer) renderText(buf *bytes.Buffer, layer tmpl.Layer, vars map[string]string) error {
	if layer.TextProps == nil {
		return nil
	}
	p := layer.TextProps

	content := resolveTextContent(p, vars)

	anchor := "start"
	switch p.Align {
	case "center":
		anchor = "middle"
	case "right":
		anchor = "end"
	}

	fontWeight := "400"
	if p.FontWeight > 0 {
		fontWeight = fmt.Sprintf("%d", p.FontWeight)
	} else if p.Bold {
		fontWeight = "700"
	}
	fontStyle := "normal"
	if p.Italic {
		fontStyle = "italic"
	}

	transform := ""
	if layer.Rotation != 0 {
		// layer.X/Y is the center of the element
		transform = fmt.Sprintf(` transform="rotate(%.2f %.2f %.2f)"`, layer.Rotation, layer.X, layer.Y)
	}

	// layer.X is center; SVG text x depends on anchor
	var textX float64
	switch p.Align {
	case "center":
		textX = layer.X
	case "right":
		textX = layer.X + layer.Width/2
	default: // left / start
		textX = layer.X - layer.Width/2
	}
	// layer.Y is center; SVG text y is the baseline = top-of-element + font size
	textY := layer.Y - layer.Height/2 + p.FontSize

	fmt.Fprintf(buf,
		`<text x="%.2f" y="%.2f" font-size="%.2f" font-family="%s" font-weight="%s" font-style="%s" fill="%s" text-anchor="%s"%s>%s</text>`,
		textX, textY,
		p.FontSize, escapeAttr(p.FontFamily), fontWeight, fontStyle,
		escapeAttr(r.color(p.Color)), anchor, transform, escapeContent(content),
	)
	return nil
}

func (r *SVGRenderer) renderImage(buf *bytes.Buffer, layer tmpl.Layer) {
	if layer.ImageProps == nil {
		return
	}
	// layer.X/Y is center; derive top-left for SVG <image>
	imgX := layer.X - layer.Width/2
	imgY := layer.Y - layer.Height/2

	var transform string
	if layer.Rotation != 0 {
		transform = fmt.Sprintf(` transform="rotate(%.2f %.2f %.2f)"`, layer.Rotation, layer.X, layer.Y)
	}

	// Asset URLs are resolved by the caller or we embed via data URI in production
	fmt.Fprintf(buf,
		`<image href="%s" x="%.2f" y="%.2f" width="%.2f" height="%.2f"%s/>`,
		escapeAttr(layer.ImageProps.AssetKey), imgX, imgY, layer.Width, layer.Height, transform,
	)
}

// renderQr encodes the layer content as a QR code and emits it as a group of
// SVG <rect> elements (one per dark module). This keeps the PDF vector-clean
// and resolution-independent.
func (r *SVGRenderer) renderQr(buf *bytes.Buffer, layer tmpl.Layer, vars map[string]string) {
	if layer.QrProps == nil {
		return
	}
	qp := layer.QrProps

	// Interpolate {{variable}} tokens in the content.
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
		ecLevel = qrcode.High
	case "H":
		ecLevel = qrcode.Highest
	default:
		ecLevel = qrcode.Medium
	}

	qr, err := qrcode.New(content, ecLevel)
	if err != nil {
		return
	}
	qr.DisableBorder = true

	bitmap := qr.Bitmap()
	if len(bitmap) == 0 {
		return
	}
	nModules := len(bitmap)
	cellW := layer.Width / float64(nModules)
	cellH := layer.Height / float64(nModules)

	dark := qp.ColorDark
	if dark == "" {
		dark = "#000000"
	}
	light := qp.ColorLight
	if light == "" {
		light = "#ffffff"
	}

	// Compute origin (top-left of layer in SVG coords).
	oxSVG := layer.X - layer.Width/2
	expandoySVG := layer.Y - layer.Height/2

	var transform string
	if layer.Rotation != 0 {
		transform = fmt.Sprintf(` transform="rotate(%.2f %.2f %.2f)"`, layer.Rotation, layer.X, layer.Y)
	}

	// Outer group: background fill + rotation.
	fmt.Fprintf(buf,
		`<g%s><rect x="%.3f" y="%.3f" width="%.3f" height="%.3f" fill="%s"/>`,
		transform, oxSVG, expandoySVG, layer.Width, layer.Height, escapeAttr(r.color(light)),
	)

	// One <rect> per dark module.
	for row, cols := range bitmap {
		for col, isDark := range cols {
			if !isDark {
				continue
			}
			mx := oxSVG + float64(col)*cellW
			my := expandoySVG + float64(row)*cellH
			fmt.Fprintf(buf,
				`<rect x="%.3f" y="%.3f" width="%.3f" height="%.3f" fill="%s"/>`,
				mx, my, cellW, cellH, escapeAttr(r.color(dark)),
			)
		}
	}
	buf.WriteString(`</g>`)
}

func sortLayersByZ(layers []tmpl.Layer) {
	for i := 1; i < len(layers); i++ {
		for j := i; j > 0 && layers[j].ZIndex < layers[j-1].ZIndex; j-- {
			layers[j], layers[j-1] = layers[j-1], layers[j]
		}
	}
}

func escapeAttr(s string) string {
	s = strings.ReplaceAll(s, "&", "&amp;")
	s = strings.ReplaceAll(s, `"`, "&quot;")
	return s
}

func escapeContent(s string) string {
	s = strings.ReplaceAll(s, "&", "&amp;")
	s = strings.ReplaceAll(s, "<", "&lt;")
	s = strings.ReplaceAll(s, ">", "&gt;")
	return s
}

// --- Shape rendering ---

// renderShape draws a vector shape layer. Path-kind shapes use shape_props.path_props.
// Legacy kinds (rect/circle/line) are rendered as best-effort native SVG.
func (r *SVGRenderer) renderShape(buf *bytes.Buffer, layer tmpl.Layer) {
	if layer.ShapeProps == nil {
		return
	}
	sp := layer.ShapeProps

	// Build local-space path data. Path-local coords run (0,0)..(width,height).
	var d string
	switch sp.Kind {
	case "path":
		if sp.PathProps == nil {
			return
		}
		d = pathPropsToSVGd(sp.PathProps)
	case "rect":
		d = rectPathD(layer.Width, layer.Height, sp.CornerRadius)
	case "circle":
		d = ellipsePathD(layer.Width, layer.Height)
	case "line":
		d = fmt.Sprintf("M 0 %.3f L %.3f %.3f", layer.Height/2, layer.Width, layer.Height/2)
	default:
		return
	}
	if d == "" {
		return
	}

	// Group transform: rotate around layer center, then translate to top-left.
	var transform string
	if layer.Rotation != 0 {
		transform = fmt.Sprintf(
			`translate(%.3f %.3f) rotate(%.3f) translate(%.3f %.3f)`,
			layer.X, layer.Y, layer.Rotation, -layer.Width/2, -layer.Height/2,
		)
	} else {
		transform = fmt.Sprintf(`translate(%.3f %.3f)`, layer.X-layer.Width/2, layer.Y-layer.Height/2)
	}

	fillAttr := buildFillAttr(r, sp, layer.Width, layer.Height)
	fillRule := fillRuleOrDefault(sp)
	opacity := 1.0
	if sp.Opacity > 0 && sp.Opacity <= 1 {
		opacity = sp.Opacity
	}

	strokeColor := r.color(sp.StrokeColor)
	strokeWidth := sp.StrokeWidth
	hasStroke := strokeColor != "" && strokeWidth > 0

	// Open group with transform + opacity.
	fmt.Fprintf(buf, `<g transform="%s" opacity="%.3f">`, transform, opacity)

	// 1. Fill path (no stroke).
	fmt.Fprintf(buf,
		`<path d="%s" fill="%s" fill-rule="%s" stroke="none"/>`,
		d, fillAttr, fillRule,
	)

	// 2. Stroke path with alignment handling.
	if hasStroke {
		align := sp.StrokeAlignment
		if align == "" {
			align = "center"
		}
		strokeAttrs := buildStrokeAttrs(sp, strokeWidth)
		switch align {
		case "center":
			fmt.Fprintf(buf,
				`<path d="%s" fill="none" stroke="%s" stroke-width="%.3f"%s/>`,
				d, escapeAttr(strokeColor), strokeWidth, strokeAttrs,
			)
		case "inside":
			// Clip a 2x-width stroke to the path's interior.
			clipID := r.nextDefID("clipIn")
			fmt.Fprintf(&r.defs,
				`<clipPath id="%s"><path d="%s" fill-rule="%s"/></clipPath>`,
				clipID, d, fillRule,
			)
			fmt.Fprintf(buf,
				`<path d="%s" fill="none" stroke="%s" stroke-width="%.3f" clip-path="url(#%s)"%s/>`,
				d, escapeAttr(strokeColor), strokeWidth*2, clipID, strokeAttrs,
			)
		case "outside":
			// Clip a 2x-width stroke to the exterior using even-odd
			// (huge rect XOR path interior).
			clipID := r.nextDefID("clipOut")
			huge := 100000.0
			fmt.Fprintf(&r.defs,
				`<clipPath id="%s" clipPathUnits="userSpaceOnUse"><path d="M %.0f %.0f L %.0f %.0f L %.0f %.0f L %.0f %.0f Z %s" fill-rule="evenodd"/></clipPath>`,
				clipID,
				-huge, -huge, huge, -huge, huge, huge, -huge, huge,
				d,
			)
			fmt.Fprintf(buf,
				`<path d="%s" fill="none" stroke="%s" stroke-width="%.3f" clip-path="url(#%s)"%s/>`,
				d, escapeAttr(strokeColor), strokeWidth*2, clipID, strokeAttrs,
			)
		}
	}

	buf.WriteString(`</g>`)
}

// pathPropsToSVGd builds an SVG path "d" attribute from PathProps.
// Coords are local (path-space). Mirrors the frontend pathPropsToSvgD.
func pathPropsToSVGd(p *tmpl.PathProps) string {
	if p == nil || len(p.Subpaths) == 0 {
		return ""
	}
	var b strings.Builder
	for _, sp := range p.Subpaths {
		if len(sp.Anchors) == 0 {
			continue
		}
		first := sp.Anchors[0]
		fmt.Fprintf(&b, "M %.3f %.3f ", first.X, first.Y)
		for i := 1; i < len(sp.Anchors); i++ {
			prev := sp.Anchors[i-1]
			cur := sp.Anchors[i]
			c1x := prev.X + prev.HoX
			c1y := prev.Y + prev.HoY
			c2x := cur.X + cur.HiX
			c2y := cur.Y + cur.HiY
			if prev.HoX == 0 && prev.HoY == 0 && cur.HiX == 0 && cur.HiY == 0 {
				fmt.Fprintf(&b, "L %.3f %.3f ", cur.X, cur.Y)
			} else {
				fmt.Fprintf(&b, "C %.3f %.3f %.3f %.3f %.3f %.3f ",
					c1x, c1y, c2x, c2y, cur.X, cur.Y)
			}
		}
		if sp.Closed {
			last := sp.Anchors[len(sp.Anchors)-1]
			c1x := last.X + last.HoX
			c1y := last.Y + last.HoY
			c2x := first.X + first.HiX
			c2y := first.Y + first.HiY
			if last.HoX == 0 && last.HoY == 0 && first.HiX == 0 && first.HiY == 0 {
				// Z closes implicitly.
			} else {
				fmt.Fprintf(&b, "C %.3f %.3f %.3f %.3f %.3f %.3f ",
					c1x, c1y, c2x, c2y, first.X, first.Y)
			}
			b.WriteString("Z ")
		}
	}
	return strings.TrimSpace(b.String())
}

func fillRuleOrDefault(s *tmpl.ShapeProps) string {
	if s == nil || s.PathProps == nil {
		return "nonzero"
	}
	if s.PathProps.FillRule == "evenodd" {
		return "evenodd"
	}
	return "nonzero"
}

// rectPathD returns the SVG "d" string for a rounded rectangle in path-local space.
func rectPathD(w, h, r float64) string {
	if r <= 0 {
		return fmt.Sprintf("M 0 0 L %.3f 0 L %.3f %.3f L 0 %.3f Z", w, w, h, h)
	}
	if r > w/2 {
		r = w / 2
	}
	if r > h/2 {
		r = h / 2
	}
	// Use arcs for corners.
	return fmt.Sprintf(
		"M %.3f 0 L %.3f 0 A %.3f %.3f 0 0 1 %.3f %.3f L %.3f %.3f A %.3f %.3f 0 0 1 %.3f %.3f L %.3f %.3f A %.3f %.3f 0 0 1 %.3f %.3f L 0 %.3f A %.3f %.3f 0 0 1 %.3f 0 Z",
		r, w-r,
		r, r, w, r,
		w, h-r,
		r, r, w-r, h,
		r, h,
		r, r, 0.0, h-r,
		r,
		r, r, r,
	)
}

// ellipsePathD returns the SVG "d" string for an ellipse fitting the bounding box.
func ellipsePathD(w, h float64) string {
	rx := w / 2
	ry := h / 2
	return fmt.Sprintf(
		"M 0 %.3f A %.3f %.3f 0 1 0 %.3f %.3f A %.3f %.3f 0 1 0 0 %.3f Z",
		ry, rx, ry, w, ry, rx, ry, ry,
	)
}

func buildFillAttr(r *SVGRenderer, sp *tmpl.ShapeProps, w, h float64) string {
	fillType := sp.FillType
	if fillType == "solid" {
		if sp.FillColor == "" || sp.FillColor == "none" || sp.FillColor == "transparent" {
			return "none"
		}
		return escapeAttr(r.color(sp.FillColor))
	} else if fillType == "gradient" {
		if len(sp.GradientStops) == 0 {
			return "none"
		}
		if sp.GradientType == "linear" {
			id := r.nextDefID("lg")
			rad := sp.GradientAngle * math.Pi / 180.0
			dx := math.Cos(rad)
			dy := math.Sin(rad)
			x1 := 0.5 - dx*0.5
			y1 := 0.5 - dy*0.5
			x2 := 0.5 + dx*0.5
			y2 := 0.5 + dy*0.5
			fmt.Fprintf(&r.defs,
				`<linearGradient id="%s" x1="%.3f" y1="%.3f" x2="%.3f" y2="%.3f">`,
				id, x1, y1, x2, y2,
			)
			for _, s := range sp.GradientStops {
				fmt.Fprintf(&r.defs, `<stop offset="%.3f" stop-color="%s"/>`, s.Offset, escapeAttr(r.color(s.Color)))
			}
			r.defs.WriteString(`</linearGradient>`)
			return fmt.Sprintf("url(#%s)", id)
		} else {
			id := r.nextDefID("rg")
			fmt.Fprintf(&r.defs,
				`<radialGradient id="%s" cx="0.500" cy="0.500" r="0.500" fx="0.500" fy="0.500">`,
				id,
			)
			for _, s := range sp.GradientStops {
				fmt.Fprintf(&r.defs, `<stop offset="%.3f" stop-color="%s"/>`, s.Offset, escapeAttr(r.color(s.Color)))
			}
			r.defs.WriteString(`</radialGradient>`)
			return fmt.Sprintf("url(#%s)", id)
		}
	} else if fillType == "none" {
		return "none"
	}

	// Fallback to legacy Fill object if present
	f := sp.Fill
	if f == nil {
		return "none"
	}
	switch f.Type {
	case "solid":
		if f.Color == "" {
			return "none"
		}
		return escapeAttr(r.color(f.Color))
	case "linear":
		if len(f.Stops) == 0 {
			return "none"
		}
		id := r.nextDefID("lg")
		// Convert angle (deg) into x1,y1,x2,y2 across the unit box.
		rad := f.Angle * math.Pi / 180.0
		dx := math.Cos(rad)
		dy := math.Sin(rad)
		x1 := 0.5 - dx*0.5
		y1 := 0.5 - dy*0.5
		x2 := 0.5 + dx*0.5
		y2 := 0.5 + dy*0.5
		fmt.Fprintf(&r.defs,
			`<linearGradient id="%s" x1="%.3f" y1="%.3f" x2="%.3f" y2="%.3f">`,
			id, x1, y1, x2, y2,
		)
		for _, s := range f.Stops {
			fmt.Fprintf(&r.defs, `<stop offset="%.3f" stop-color="%s"/>`, s.Offset, escapeAttr(r.color(s.Color)))
		}
		r.defs.WriteString(`</linearGradient>`)
		return fmt.Sprintf("url(#%s)", id)
	case "radial":
		if len(f.Stops) == 0 {
			return "none"
		}
		id := r.nextDefID("rg")
		cx := f.CX
		cy := f.CY
		rad := f.Radius
		if rad <= 0 {
			rad = 0.5
		}
		fmt.Fprintf(&r.defs,
			`<radialGradient id="%s" cx="%.3f" cy="%.3f" r="%.3f" fx="%.3f" fy="%.3f">`,
			id, cx, cy, rad, cx, cy,
		)
		for _, s := range f.Stops {
			fmt.Fprintf(&r.defs, `<stop offset="%.3f" stop-color="%s"/>`, s.Offset, escapeAttr(r.color(s.Color)))
		}
		r.defs.WriteString(`</radialGradient>`)
		return fmt.Sprintf("url(#%s)", id)
	}
	return "none"
}

// buildStrokeAttrs returns extra SVG attributes for a stroke (linecap/join/miter/dasharray).
// The leading space is included so the result can be inlined directly in a tag.
func buildStrokeAttrs(sp *tmpl.ShapeProps, _ float64) string {
	var b strings.Builder
	if sp.StrokeLineCap != "" {
		fmt.Fprintf(&b, ` stroke-linecap="%s"`, escapeAttr(sp.StrokeLineCap))
	}
	if sp.StrokeLineJoin != "" {
		fmt.Fprintf(&b, ` stroke-linejoin="%s"`, escapeAttr(sp.StrokeLineJoin))
	}
	if sp.StrokeLineJoin == "miter" && sp.StrokeMiterLimit > 0 {
		fmt.Fprintf(&b, ` stroke-miterlimit="%.3f"`, sp.StrokeMiterLimit)
	}
	if len(sp.StrokeDash) > 0 {
		parts := make([]string, len(sp.StrokeDash))
		for i, v := range sp.StrokeDash {
			parts[i] = fmt.Sprintf("%.3f", v)
		}
		fmt.Fprintf(&b, ` stroke-dasharray="%s"`, strings.Join(parts, ","))
	}
	return b.String()
}
