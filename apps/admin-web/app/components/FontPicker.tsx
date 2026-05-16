import { useEffect, useRef, useState } from "react";
import { Check, ChevronsUpDown, Upload } from "lucide-react";
import { cn } from "~/lib/utils";
import {
  GOOGLE_FONTS,
  SYSTEM_FONTS,
  DEFAULT_WEIGHTS,
  fetchGoogleFonts,
  loadGoogleFont,
  loadCustomFontFile,
  getCustomFonts,
  getFontVariants,
  subscribeCustomFonts,
  getLibraryFonts,
  subscribeLibraryFonts,
  loadFontFromURL,
  type LibraryFont,
  type GoogleFontMeta,
} from "~/lib/fonts";
import { listFonts, uploadFont } from "~/lib/api/fonts";
import { Button } from "~/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "~/components/ui/command";

// ---- Types ----

interface FontEntry {
  family: string;
  group: "system" | "google" | "custom" | "library";
  objectKey?: string;
}

// ---- Module-level font list cache ----

let cachedFonts: FontEntry[] | null = null;
let fetchPromise: Promise<FontEntry[]> | null = null;

async function loadFontList(): Promise<FontEntry[]> {
  if (cachedFonts) return cachedFonts;
  if (fetchPromise) return fetchPromise;

  fetchPromise = (async () => {
    const system: FontEntry[] = SYSTEM_FONTS.map((f) => ({ family: f, group: "system" as const }));
    const fetched = await fetchGoogleFonts();
    const google: FontEntry[] =
      fetched.length > 0
        ? fetched.map(({ family }) => ({ family, group: "google" as const }))
        : GOOGLE_FONTS.map((f) => ({ family: f, group: "google" as const }));
    cachedFonts = [...system, ...google];
    return cachedFonts;
  })();

  return fetchPromise;
}

// ---- FontPicker component ----

interface FontPickerProps {
  value: string;
  /** Called when a font is selected. `assetKey` is set for library fonts (use it as `font_asset_key`). */
  onChange: (family: string, assetKey?: string) => void;
  className?: string;
  onUpload?: (family: string) => void;
}

const VISIBLE_GOOGLE_LIMIT = 100;

export function FontPicker({ value, onChange, className, onUpload }: FontPickerProps) {
  const [open, setOpen] = useState(false);
  const [fonts, setFonts] = useState<FontEntry[]>(() =>
    // Start with system fonts only; all Google Fonts are fetched from the API
    SYSTEM_FONTS.map((f) => ({ family: f, group: "system" as const })),
  );
  const [loadingFonts, setLoadingFonts] = useState(true);
  const [search, setSearch] = useState("");
  const [customFonts, setCustomFonts] = useState<string[]>(() => getCustomFonts());
  const [libraryFonts, setLibraryFonts] = useState<LibraryFont[]>(() => getLibraryFonts());
  const [loadingLibrary, setLoadingLibrary] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Fetch full Google Fonts list
  useEffect(() => {
    loadFontList().then((list) => {
      setFonts(list);
      setLoadingFonts(false);
    });
  }, []);

  // Load library fonts from API on mount
  useEffect(() => {
    setLoadingLibrary(true);
    listFonts()
      .then(async (records) => {
        for (const r of records) {
          await loadFontFromURL(r.family_name, r.asset_url, r.object_key);
        }
        setLibraryFonts(getLibraryFonts());
      })
      .catch(() => { /* ignore network errors */ })
      .finally(() => setLoadingLibrary(false));
  }, []);

  // Track custom fonts
  useEffect(() => {
    return subscribeCustomFonts(() => setCustomFonts(getCustomFonts()));
  }, []);

  // Track library fonts
  useEffect(() => {
    return subscribeLibraryFonts(() => setLibraryFonts(getLibraryFonts()));
  }, []);

  // Load the current font into the browser so the preview renders
  useEffect(() => {
    if (value) loadGoogleFont(value);
  }, [value]);

  const handleSelect = (entry: FontEntry) => {
    if (entry.group !== "library") loadGoogleFont(entry.family);
    onChange(entry.family, entry.objectKey);
    setOpen(false);
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    try {
      // Upload to the persistent font library
      const record = await uploadFont(file);
      await loadFontFromURL(record.family_name, record.asset_url, record.object_key);
      onChange(record.family_name, record.object_key);
      onUpload?.(record.family_name);
    } catch {
      // Fallback: register only locally for this session
      const family = await loadCustomFontFile(file);
      onChange(family);
      onUpload?.(family);
    }
    setOpen(false);
  };

  const libraryFamilySet = new Set(libraryFonts.map((f) => f.family));
  const allEntries: FontEntry[] = [
    ...fonts.filter((e) => !libraryFamilySet.has(e.family)),
    ...customFonts
      .filter((f) => !fonts.some((e) => e.family === f) && !libraryFamilySet.has(f))
      .map((f): FontEntry => ({ family: f, group: "custom" })),
    ...libraryFonts.map((lf): FontEntry => ({ family: lf.family, group: "library", objectKey: lf.objectKey })),
  ];

  const groups: { system: FontEntry[]; google: FontEntry[]; custom: FontEntry[]; library: FontEntry[] } = {
    system: [],
    google: [],
    custom: [],
    library: [],
  };
  for (const entry of allEntries) groups[entry.group].push(entry);

  // When not searching, cap the Google list to avoid rendering 1400+ items at once.
  // cmdk already filters by the search value internally, so the full list is available when typing.
  const q = search.trim().toLowerCase();
  const visibleGoogle = q
    ? groups.google
    : groups.google.slice(0, VISIBLE_GOOGLE_LIMIT);
  const googleTruncated = !q && groups.google.length > VISIBLE_GOOGLE_LIMIT;

  return (
    <div className={cn("flex gap-1", className)}>
      <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setSearch(""); }}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="flex-1 justify-between font-normal h-8 text-sm px-2"
            style={{ fontFamily: value }}
          >
            <span className="truncate">{value || "Select font…"}</span>
            <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>

        <PopoverContent className="w-64 p-0" align="start">
          <Command>
            <CommandInput placeholder="Search fonts…" value={search} onValueChange={setSearch} />
            <CommandList>
              <CommandEmpty>No font found.</CommandEmpty>

              {groups.library.length > 0 && (
                <>
                  <CommandGroup heading="Font Library">
                    {groups.library.map((e) => (
                      <FontItem key={e.family} family={e.family} selected={value === e.family} onSelect={() => handleSelect(e)} />
                    ))}
                  </CommandGroup>
                  <CommandSeparator />
                </>
              )}
              {loadingLibrary && groups.library.length === 0 && (
                <CommandGroup heading="Font Library">
                  <CommandItem disabled>Loading library…</CommandItem>
                </CommandGroup>
              )}

              {groups.custom.length > 0 && (
                <>
                  <CommandGroup heading="Custom (local)">
                    {groups.custom.map((e) => (
                      <FontItem key={e.family} family={e.family} selected={value === e.family} onSelect={() => handleSelect(e)} />
                    ))}
                  </CommandGroup>
                  <CommandSeparator />
                </>
              )}

              <CommandGroup heading="System">
                {groups.system.map((e) => (
                  <FontItem key={e.family} family={e.family} selected={value === e.family} onSelect={() => handleSelect(e)} />
                ))}
              </CommandGroup>

              <CommandSeparator />

              <CommandGroup heading="Google Fonts">
                {loadingFonts ? (
                  <CommandItem disabled>Loading fonts…</CommandItem>
                ) : (
                  <>
                    {visibleGoogle.map((e) => (
                      <FontItem key={e.family} family={e.family} selected={value === e.family} onSelect={() => handleSelect(e)} />
                    ))}
                    {googleTruncated && (
                      <CommandItem disabled className="text-xs text-muted-foreground">
                        Type to search all {groups.google.length} fonts…
                      </CommandItem>
                    )}
                  </>
                )}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {/* Upload custom font */}
      <Button
        type="button"
        variant="outline"
        size="icon-sm"
        title="Upload OTF/TTF font"
        onClick={() => fileRef.current?.click()}
      >
        <Upload className="h-3.5 w-3.5" />
      </Button>
      <input
        ref={fileRef}
        type="file"
        accept=".otf,.ttf,.woff,.woff2,font/otf,font/ttf,font/woff,font/woff2"
        className="hidden"
        onChange={handleUpload}
      />
    </div>
  );
}

// ---- WeightPicker component ----

const WEIGHT_LABELS: Record<number, string> = {
  100: "Thin",
  200: "ExtraLight",
  300: "Light",
  400: "Regular",
  500: "Medium",
  600: "SemiBold",
  700: "Bold",
  800: "ExtraBold",
  900: "Black",
};

export function WeightPicker({
  fontFamily,
  value,
  onChange,
  className,
}: {
  fontFamily: string;
  value: number;
  onChange: (w: number) => void;
  className?: string;
}) {
  const weights = getFontVariants(fontFamily).length ? getFontVariants(fontFamily) : DEFAULT_WEIGHTS;
  return (
    <select
      className={cn(
        "flex h-8 w-full rounded-md border border-input bg-background px-2 py-1 text-xs",
        className,
      )}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
    >
      {weights.map((w) => (
        <option key={w} value={w}>
          {w} – {WEIGHT_LABELS[w] ?? ""}
        </option>
      ))}
    </select>
  );
}

// ---- FontItem sub-component ----

function FontItem({
  family,
  selected,
  onSelect,
}: {
  family: string;
  selected: boolean;
  onSelect: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // Lazy-load the font only when the item scrolls into view
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          loadGoogleFont(family);
          observer.disconnect();
        }
      },
      { threshold: 0.1 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [family]);

  return (
    <CommandItem
      ref={ref}
      value={family}
      onSelect={onSelect}
      style={{ fontFamily: family }}
    >
      <Check className={cn("shrink-0", selected ? "opacity-100" : "opacity-0")} />
      {family}
    </CommandItem>
  );
}
