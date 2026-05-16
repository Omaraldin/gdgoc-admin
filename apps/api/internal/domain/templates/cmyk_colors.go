package templates

import (
	"fmt"
	"strconv"
	"strings"
)

// CMYK represents a color in the CMYK color space (values 0–100).
type CMYK struct {
	C, M, Y, K float64
}

// googleCMYK maps Google brand hex colors (lowercase, no #) to their
// official CMYK values from the Google Brand Guidelines.
var googleCMYK = map[string]CMYK{
	// Core Colors
	"4285f4": {C: 88, M: 45, Y: 0, K: 0},  // Blue 500
	"34a853": {C: 76, M: 0, Y: 87, K: 0},  // Green 500
	"f9ab00": {C: 0, M: 25, Y: 100, K: 0}, // Yellow 600
	"ea4335": {C: 0, M: 90, Y: 88, K: 0},  // Red 500
	// Halftones
	"57caff": {C: 67, M: 8, Y: 0, K: 0},  // Halftone Blue
	"5cdb6d": {C: 30, M: 0, Y: 66, K: 0}, // Halftone Green
	"ffd427": {C: 0, M: 7, Y: 100, K: 0}, // Halftone Yellow
	"ff7daf": {C: 1, M: 48, Y: 0, K: 0},  // Halftone Red
	// Pastels
	"c3ecf6": {C: 28, M: 0, Y: 1, K: 0},  // Pastel Blue
	"ccf6c5": {C: 15, M: 0, Y: 15, K: 0}, // Pastel Green
	"ffe7a5": {C: 0, M: 3, Y: 40, K: 0},  // Pastel Yellow
	"f8d8d8": {C: 1, M: 14, Y: 3, K: 0},  // Pastel Red
	// Grayscale
	"f0f0f0": {C: 6, M: 4, Y: 4, K: 2},  // OFF White
	"1e1e1e": {C: 0, M: 0, Y: 0, K: 90}, // Black 02
	// Alias: white / black
	"ffffff": {C: 0, M: 0, Y: 0, K: 0},
	"000000": {C: 0, M: 0, Y: 0, K: 100},
}

// hexToRGBParts parses a CSS hex color (#rrggbb or #rgb) into 0–255 components.
func hexToRGBParts(hex string) (r, g, b uint8, ok bool) {
	hex = strings.TrimPrefix(strings.ToLower(strings.TrimSpace(hex)), "#")
	if len(hex) == 3 {
		hex = string([]byte{hex[0], hex[0], hex[1], hex[1], hex[2], hex[2]})
	}
	if len(hex) != 6 {
		return 0, 0, 0, false
	}
	ri, err := strconv.ParseUint(hex[0:2], 16, 8)
	if err != nil {
		return 0, 0, 0, false
	}
	gi, err := strconv.ParseUint(hex[2:4], 16, 8)
	if err != nil {
		return 0, 0, 0, false
	}
	bi, err := strconv.ParseUint(hex[4:6], 16, 8)
	if err != nil {
		return 0, 0, 0, false
	}
	return uint8(ri), uint8(gi), uint8(bi), true
}

// rgbToCMYKColor converts sRGB (0–255 each) to CMYK (0–100 each).
func rgbToCMYKColor(r, g, b uint8) CMYK {
	rf := float64(r) / 255.0
	gf := float64(g) / 255.0
	bf := float64(b) / 255.0

	k := 1 - cmykMax3(rf, gf, bf)
	if k == 1 {
		return CMYK{C: 0, M: 0, Y: 0, K: 100}
	}
	c := (1 - rf - k) / (1 - k)
	m := (1 - gf - k) / (1 - k)
	y := (1 - bf - k) / (1 - k)
	return CMYK{
		C: cmykRound2(c * 100),
		M: cmykRound2(m * 100),
		Y: cmykRound2(y * 100),
		K: cmykRound2(k * 100),
	}
}

func cmykMax3(a, b, c float64) float64 {
	if a >= b && a >= c {
		return a
	}
	if b >= c {
		return b
	}
	return c
}

func cmykRound2(v float64) float64 {
	return float64(int(v*100+0.5)) / 100
}

// cmykColorToHex converts CMYK (0–100) back to the nearest sRGB hex string.
func cmykColorToHex(c CMYK) string {
	cf := c.C / 100.0
	mf := c.M / 100.0
	yf := c.Y / 100.0
	kf := c.K / 100.0

	r := 255 * (1 - cf) * (1 - kf)
	g := 255 * (1 - mf) * (1 - kf)
	b := 255 * (1 - yf) * (1 - kf)
	return fmt.Sprintf("#%02x%02x%02x", cmykClamp(r), cmykClamp(g), cmykClamp(b))
}

func cmykClamp(v float64) uint8 {
	if v < 0 {
		return 0
	}
	if v > 255 {
		return 255
	}
	return uint8(v + 0.5)
}

// MapColorPrintable converts a hex color to its CMYK-correct RGB equivalent.
// Google brand colors use official CMYK values; others use standard RGB→CMYK→RGB.
// Non-hex strings (e.g. "none", "transparent") are returned unchanged.
func MapColorPrintable(hexColor string) string {
	norm := strings.ToLower(strings.TrimSpace(strings.TrimPrefix(hexColor, "#")))
	if len(norm) == 3 {
		norm = string([]byte{norm[0], norm[0], norm[1], norm[1], norm[2], norm[2]})
	}
	if cmyk, ok := googleCMYK[norm]; ok {
		return cmykColorToHex(cmyk)
	}
	r, g, b, ok := hexToRGBParts(hexColor)
	if !ok {
		return hexColor
	}
	return cmykColorToHex(rgbToCMYKColor(r, g, b))
}

// MapSceneColorsPrintable returns a deep copy of the scene with all hex colors
// replaced by their CMYK-correct RGB equivalents (via MapColorPrintable).
// Google brand colors are mapped using official CMYK values; all other colors
// use the standard RGB→CMYK→RGB formula.
func MapSceneColorsPrintable(scene SceneDefinition) SceneDefinition {
	out := scene
	out.Background = MapColorPrintable(scene.Background)

	layers := make([]Layer, len(scene.Layers))
	copy(layers, scene.Layers)
	for i, l := range layers {
		if l.TextProps != nil {
			cp := *l.TextProps
			cp.Color = MapColorPrintable(l.TextProps.Color)
			layers[i].TextProps = &cp
		}
		if l.ShapeProps != nil {
			sp := *l.ShapeProps
			if sp.Fill != nil {
				f := *sp.Fill
				f.Color = MapColorPrintable(f.Color)
				stops := make([]GradientStop, len(f.Stops))
				for j, s := range f.Stops {
					stops[j] = GradientStop{Offset: s.Offset, Color: MapColorPrintable(s.Color)}
				}
				f.Stops = stops
				sp.Fill = &f
			}
			sp.StrokeColor = MapColorPrintable(l.ShapeProps.StrokeColor)
			layers[i].ShapeProps = &sp
		}
	}
	out.Layers = layers
	return out
}
