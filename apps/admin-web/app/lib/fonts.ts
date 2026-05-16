// ---- Google Fonts API ----

export interface GoogleFontMeta {
  family: string;
  category: string; // "sans-serif" | "serif" | "display" | "handwriting" | "monospace"
  variants?: number[]; // available numeric weights, e.g. [100, 300, 400, 700, 900]
}

/** Module-level cache of family → available weights (populated by fetchGoogleFonts). */
const fontVariantsMap = new Map<string, number[]>();

/** Default weight set shown in the picker when no variant data is available yet. */
export const DEFAULT_WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900];

/** Returns the available font weights for a given font family. */
export function getFontVariants(family: string): number[] {
  return fontVariantsMap.get(family) ?? DEFAULT_WEIGHTS;
}

function parseVariantWeights(rawVariants: string[]): number[] {
  const weights = rawVariants.map((v) => {
    if (v === "regular" || v === "italic") return 400;
    const n = parseInt(v.replace(/italic$/i, ""), 10);
    return isNaN(n) ? null : n;
  }).filter((n): n is number => n !== null);
  return [...new Set(weights)].sort((a, b) => a - b);
}

/**
 * Fetch the full list of Google Fonts.
 * Prefers the official Developer API when VITE_GOOGLE_FONTS_API_KEY is set (sorted by popularity).
 * Falls back to Bunny Fonts (a Google Fonts mirror) which requires no API key and
 * exposes the complete ~1400+ font catalogue.
 * Returns an empty array only when both sources fail, so callers can use GOOGLE_FONTS.
 */
export async function fetchGoogleFonts(): Promise<GoogleFontMeta[]> {
  const key = import.meta.env.VITE_GOOGLE_FONTS_API_KEY as string | undefined;

  if (key) {
    try {
      const res = await fetch(
        `https://www.googleapis.com/webfonts/v1/webfonts?key=${encodeURIComponent(key)}&sort=popularity`,
      );
      if (res.ok) {
        const data = (await res.json()) as { items?: Array<{ family: string; category: string; variants?: string[] }> };
        const items = data.items ?? [];
        if (items.length > 0) {
          return items.map(({ family, category, variants: raw = [] }) => {
            const weights = parseVariantWeights(raw);
            if (weights.length) fontVariantsMap.set(family, weights);
            return { family, category, variants: weights.length ? weights : undefined };
          });
        }
      }
    } catch {
      // fall through to Bunny Fonts
    }
  }

  // Fallback: Bunny Fonts mirrors the entire Google Fonts catalogue — no key required.
  try {
    const res = await fetch("https://fonts.bunny.net/list");
    if (!res.ok) return [];
    const data = (await res.json()) as Record<string, { category: string; variants?: string[] }>;
    return Object.entries(data).map(([family, meta]) => {
      const weights = parseVariantWeights(meta.variants ?? []);
      if (weights.length) fontVariantsMap.set(family, weights);
      return { family, category: meta.category ?? "sans-serif", variants: weights.length ? weights : undefined };
    });
  } catch {
    return [];
  }
}

// Curated list of popular Google Fonts. The editor loads them dynamically by injecting
// <link> tags into <head>. To add a font, append it here and it will become available
// in the font picker.
export const GOOGLE_FONTS: string[] = [
  "Roboto",
  "Open Sans",
  "Lato",
  "Montserrat",
  "Poppins",
  "Inter",
  "Oswald",
  "Raleway",
  "Nunito",
  "Merriweather",
  "Playfair Display",
  "Source Sans 3",
  "PT Sans",
  "PT Serif",
  "Roboto Slab",
  "Roboto Condensed",
  "Roboto Mono",
  "Bebas Neue",
  "Dancing Script",
  "Pacifico",
  "Great Vibes",
  "Allura",
  "Sacramento",
  "Cormorant Garamond",
  "Cinzel",
  "EB Garamond",
  "Libre Baskerville",
  "Crimson Text",
  "Lora",
  "Quicksand",
  "Work Sans",
  "Rubik",
  "Fira Sans",
  "Ubuntu",
];

// System fonts always available (no need to load).
export const SYSTEM_FONTS: string[] = ["Arial", "Helvetica", "Times New Roman", "Georgia", "Courier New", "Verdana"];

const loaded = new Set<string>();

// ---- Custom (uploaded) fonts ----

/** Map of custom font family name → data URL. Module-level so it persists across renders. */
const customFontMap = new Map<string, string>();

/** Subscribers notified when a new custom font is registered. */
const customFontListeners = new Set<() => void>();

// ---- IndexedDB persistence for custom fonts ----

const FONT_DB_NAME = "gdgoc-custom-fonts";
const FONT_DB_VERSION = 1;
const FONT_STORE = "fonts";

function openFontDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(FONT_DB_NAME, FONT_DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(FONT_STORE)) {
        req.result.createObjectStore(FONT_STORE, { keyPath: "family" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function persistCustomFont(family: string, dataUrl: string): Promise<void> {
  try {
    const db = await openFontDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(FONT_STORE, "readwrite");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.objectStore(FONT_STORE).put({ family, dataUrl });
    });
    db.close();
  } catch {
    // Silently ignore (SSR or private-browsing mode)
  }
}

async function restoreCustomFonts(): Promise<void> {
  try {
    const db = await openFontDB();
    const stored = await new Promise<Array<{ family: string; dataUrl: string }>>((resolve, reject) => {
      const tx = db.transaction(FONT_STORE, "readonly");
      const req = tx.objectStore(FONT_STORE).getAll();
      req.onsuccess = () => resolve(req.result as Array<{ family: string; dataUrl: string }>);
      req.onerror = () => reject(req.error);
    });
    db.close();
    for (const { family, dataUrl } of stored) {
      if (customFontMap.has(family)) continue;
      try {
        const fontFace = new FontFace(family, `url(${dataUrl})`);
        await fontFace.load();
        document.fonts.add(fontFace);
        customFontMap.set(family, dataUrl);
      } catch {
        // Skip corrupt/invalid entries
      }
    }
    if (stored.length > 0) customFontListeners.forEach((cb) => cb());
  } catch {
    // IndexedDB unavailable
  }
}

// Restore persisted custom fonts on module load (browser only)
if (typeof window !== "undefined") {
  restoreCustomFonts();
}

/** Subscribe to custom-font changes. Returns an unsubscribe function. */
export function subscribeCustomFonts(cb: () => void): () => void {
  customFontListeners.add(cb);
  return () => customFontListeners.delete(cb);
}

/** Return current list of custom font family names. */
export function getCustomFonts(): string[] {
  return Array.from(customFontMap.keys());
}

/**
 * Load an OTF/TTF font file, register it with the browser via FontFace API,
 * and store it so the picker can list it.
 * Returns the font family name (derived from the file name).
 */
export async function loadCustomFontFile(file: File): Promise<string> {
  const family = file.name.replace(/\.[^.]+$/, ""); // strip extension
  if (customFontMap.has(family)) return family;

  const arrayBuffer = await file.arrayBuffer();
  const fontFace = new FontFace(family, arrayBuffer);
  await fontFace.load();
  document.fonts.add(fontFace);

  // Also store a data-URL so the font survives re-renders / SVG export
  const blob = new Blob([arrayBuffer], { type: file.type || "font/otf" });
  const dataUrl = await new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.readAsDataURL(blob);
  });

  customFontMap.set(family, dataUrl);
  await persistCustomFont(family, dataUrl); // persist across page reloads
  customFontListeners.forEach((cb) => cb());
  return family;
}

// All 9 standard weights × 2 styles (regular + italic).
// Modern browsers only download the variants actually used on the page.
const ALL_WEIGHT_PARAM =
  "0,100;0,200;0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,100;1,200;1,300;1,400;1,500;1,600;1,700;1,800;1,900";

// ---- Library fonts (persisted to the API / storage backend) ----

export interface LibraryFont {
  family: string;
  assetURL: string;
  objectKey: string;
}

/** Map of family → LibraryFont for fonts uploaded to the persistent font library. */
const libraryFontMap = new Map<string, LibraryFont>();

/** Families currently being fetched via loadFontFromURL (not yet in libraryFontMap). */
const pendingLibraryFamilies = new Set<string>();

const libraryFontListeners = new Set<() => void>();

/** Subscribe to library-font changes. Returns an unsubscribe function. */
export function subscribeLibraryFonts(cb: () => void): () => void {
  libraryFontListeners.add(cb);
  return () => libraryFontListeners.delete(cb);
}

/** Return the current list of library fonts. */
export function getLibraryFonts(): LibraryFont[] {
  return Array.from(libraryFontMap.values());
}

/** Register a library font and load it into the browser FontFace registry. */
export async function loadFontFromURL(family: string, assetURL: string, objectKey: string): Promise<void> {
  if (libraryFontMap.has(family)) return;
  pendingLibraryFamilies.add(family);
  try {
    const fontFace = new FontFace(family, `url(${assetURL})`);
    await fontFace.load();
    document.fonts.add(fontFace);
  } catch {
    // If load fails (e.g. network error), still register so it appears in the picker
  } finally {
    pendingLibraryFamilies.delete(family);
  }
  libraryFontMap.set(family, { family, assetURL, objectKey });
  libraryFontListeners.forEach((cb) => cb());
}

/** Load a Google Font by name (all weights). Idempotent. Works for any family name, not just the static list. */
export function loadGoogleFont(family: string): void {
  if (typeof document === "undefined") return;
  // Skip system / custom / library fonts — they need no remote loading
  if (SYSTEM_FONTS.includes(family)) return;
  if (customFontMap.has(family)) return;
  if (libraryFontMap.has(family)) return;
  if (pendingLibraryFamilies.has(family)) return; // being loaded via loadFontFromURL
  if (loaded.has(family)) return;
  loaded.add(family);

  const linkId = `gf-${family.replace(/\s+/g, "-")}`;
  if (document.getElementById(linkId)) return;

  const link = document.createElement("link");
  link.id = linkId;
  link.rel = "stylesheet";
  const familyParam = family.replace(/\s+/g, "+");
  link.href = `https://fonts.googleapis.com/css2?family=${familyParam}:ital,wght@${ALL_WEIGHT_PARAM}&display=swap`;
  document.head.appendChild(link);
}

/** Preload all fonts referenced in a scene (called on editor mount). */
export function preloadFonts(families: string[]): void {
  for (const f of families) loadGoogleFont(f);
}
