package worker

import (
	"regexp"
	"strings"

	tmpl "github.com/gdgoc/admin-api/internal/domain/templates"
)

// varPattern matches {{field_name}} interpolation tokens.
var varPattern = regexp.MustCompile(`\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}`)

// resolveTextContent returns the final text to render for a layer.
// Priority:
// 1) dynamic/script-backed value via variable_key
// 2) inline interpolation in content ({{field_name}})
func resolveTextContent(p *tmpl.TextProps, vars map[string]string) string {
	if p == nil {
		return ""
	}
	content := p.Content
	if (p.IsDynamic || p.ScriptSource != "") && p.VariableKey != "" {
		if val, ok := vars[p.VariableKey]; ok {
			return val
		}
		return content
	}
	return Interpolate(content, vars)
}

// ExtractInterpolatedVariableKeys returns unique variable keys referenced by
// {{field_name}} tokens in content.
func ExtractInterpolatedVariableKeys(content string) []string {
	matches := varPattern.FindAllStringSubmatch(content, -1)
	if len(matches) == 0 {
		return nil
	}
	seen := make(map[string]bool, len(matches))
	out := make([]string, 0, len(matches))
	for _, m := range matches {
		if len(m) < 2 {
			continue
		}
		key := strings.TrimSpace(m[1])
		if key != "" && !seen[key] {
			seen[key] = true
			out = append(out, key)
		}
	}
	return out
}

func Interpolate(content string, vars map[string]string) string {
	if content == "" || len(vars) == 0 {
		return content
	}
	return varPattern.ReplaceAllStringFunc(content, func(token string) string {
		matches := varPattern.FindStringSubmatch(token)
		if len(matches) < 2 {
			return token
		}
		key := strings.TrimSpace(matches[1])
		if val, ok := vars[key]; ok {
			return val
		}
		return token
	})
}
