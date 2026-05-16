import { useState, useEffect, useRef } from "react";
import { listFonts, uploadFont, deleteFont } from "~/lib/api/fonts";
import { loadFontFromURL } from "~/lib/fonts";
import type { FontRecord } from "~/lib/types";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { ConfirmModal } from "~/components/ConfirmModal";
import { Upload, Trash2, Type } from "lucide-react";
import { formatDate } from "~/lib/utils";

export function meta() {
  return [{ title: "Fonts | GDGoC Admin" }];
}

export default function FontLibraryPage() {
  const [fonts, setFonts] = useState<FontRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<FontRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    try {
      const data = await listFonts();
      setFonts(data);
      // Register all fonts so previews render
      for (const f of data) {
        loadFontFromURL(f.family_name, f.asset_url, f.object_key).catch(() => {});
      }
    } catch {
      setError("Failed to load font library.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setUploading(true);
    setError(null);
    try {
      const record = await uploadFont(file);
      await loadFontFromURL(record.family_name, record.asset_url, record.object_key);
      setFonts((prev) => {
        // Replace if same id already listed (dedup returned existing), else prepend
        if (prev.some((f) => f.id === record.id)) return prev;
        return [record, ...prev];
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Upload failed.";
      setError(msg);
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteFont(deleteTarget.id);
      setFonts((prev) => prev.filter((f) => f.id !== deleteTarget.id));
    } catch {
      setError("Failed to delete font.");
    } finally {
      setDeleteTarget(null);
    }
  };

  return (
    <div className="p-4 sm:p-8 max-w-5xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Font Library</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Upload custom fonts (TTF, OTF, WOFF, WOFF2) once and use them across all templates.
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
        >
          <Upload className="h-3.5 w-3.5 mr-1.5" />
          {uploading ? "Uploading…" : "Upload Font"}
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept=".ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2"
          className="hidden"
          onChange={handleUpload}
        />
      </div>

      {error && (
        <div className="mb-4 rounded-md bg-destructive/10 text-destructive text-sm px-4 py-2.5">{error}</div>
      )}

      {loading ? (
        <div className="text-center py-20 text-muted-foreground text-sm">Loading…</div>
      ) : fonts.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground">
          <Type className="mx-auto h-10 w-10 opacity-30 mb-3" />
          <p className="text-base">No fonts uploaded yet.</p>
          <p className="text-sm mt-1">Upload a font file to make it available in all template editors.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {fonts.map((f) => (
            <FontCard
              key={f.id}
              font={f}
              onDelete={() => setDeleteTarget(f)}
            />
          ))}
        </div>
      )}

      {deleteTarget && (
        <ConfirmModal
          title="Delete font"
          message={`Remove "${deleteTarget.family_name}" from the library? Templates already using this font will stop rendering correctly.`}
          confirmLabel="Delete"
          destructive
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}

function FontCard({ font, onDelete }: { font: FontRecord; onDelete: () => void }) {
  return (
    <Card className="overflow-hidden">
      <CardContent className="p-5">
        {/* Preview text rendered in the font */}
        <p
          className="text-2xl leading-snug mb-3 text-foreground truncate"
          style={{ fontFamily: font.family_name }}
        >
          {font.family_name}
        </p>
        <p
          className="text-sm text-muted-foreground mb-1 truncate"
          style={{ fontFamily: font.family_name }}
        >
          The quick brown fox jumps over the lazy dog
        </p>

        <div className="mt-3 pt-3 border-t border-border flex items-center justify-between gap-2">
          <div className="text-xs text-muted-foreground min-w-0">
            <p className="truncate font-medium text-foreground">{font.file_name}</p>
            <p className="truncate">{font.mime_type} · {formatDate(font.created_at)}</p>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-destructive hover:text-destructive shrink-0"
            title="Delete font"
            onClick={onDelete}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
