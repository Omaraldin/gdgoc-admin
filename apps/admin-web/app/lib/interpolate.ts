export function interpolate(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`)
}

export function extractInterpolatedVariableKeys(text: string): string[] {
  const keys = new Set<string>()
  text.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_, key) => {
    if (key) {
      keys.add(key)
    }
    return ""
  })
  return Array.from(keys)
}
