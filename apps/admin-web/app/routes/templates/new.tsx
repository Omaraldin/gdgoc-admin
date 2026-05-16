import { useState } from "react";
import { useNavigate } from "react-router";
import { createTemplate } from "~/lib/api/templates";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import { Card, CardContent } from "~/components/ui/card";
import { cn } from "~/lib/utils";

export function meta() {
  return [{ title: "New Template | GDGoC Admin" }];
}

type Preset = {
  id: string;
  label: string;
  description: string;
  width: number;
  height: number;
};

const PRESETS: Preset[] = [
  {
    id: "a4-landscape",
    label: "A4 Landscape",
    description: "1754 × 1240 px (A4 @ 150 DPI)",
    width: 1754,
    height: 1240,
  },
  {
    id: "a4-portrait",
    label: "A4 Portrait",
    description: "1240 × 1754 px (A4 @ 150 DPI)",
    width: 1240,
    height: 1754,
  },
  {
    id: "letter-landscape",
    label: "US Letter Landscape",
    description: "1650 × 1275 px",
    width: 1650,
    height: 1275,
  },
  {
    id: "social",
    label: "Social Card",
    description: "1200 × 630 px",
    width: 1200,
    height: 630,
  },
  {
    id: "custom",
    label: "Custom",
    description: "Enter your own dimensions",
    width: 1280,
    height: 720,
  },
];

export default function NewTemplatePage() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<"private" | "public">("private");
  const [presetId, setPresetId] = useState<string>("a4-landscape");
  const [customWidth, setCustomWidth] = useState(1280);
  const [customHeight, setCustomHeight] = useState(720);
  const [background, setBackground] = useState("#ffffff");
  const [saving, setSaving] = useState(false);

  const preset = PRESETS.find((p) => p.id === presetId)!;
  const isCustom = presetId === "custom";
  const width = isCustom ? customWidth : preset.width;
  const height = isCustom ? customHeight : preset.height;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const tmpl = await createTemplate({
        name,
        description,
        visibility,
        scene: { width, height, background, layers: [] },
      });
      navigate(`/templates/${tmpl.id}/editor`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-4 sm:p-8 max-w-3xl mx-auto">
      <h1 className="text-xl font-semibold mb-6 text-foreground">New Template</h1>
      <Card>
        <CardContent className="p-6">
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="tmpl-name">Template Name *</Label>
                <Input
                  id="tmpl-name"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tmpl-vis">Visibility</Label>
                <select
                  id="tmpl-vis"
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={visibility}
                  onChange={(e) => setVisibility(e.target.value as "private" | "public")}
                >
                  <option value="private">Private (only your chapter)</option>
                  <option value="public">Public (visible to all chapters)</option>
                </select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="tmpl-desc">Description</Label>
              <Textarea
                id="tmpl-desc"
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            <div>
              <Label className="block mb-2">Canvas Size</Label>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {PRESETS.map((p) => {
                  const selected = presetId === p.id;
                  const aspect = p.width / p.height;
                  return (
                    <button
                      type="button"
                      key={p.id}
                      onClick={() => setPresetId(p.id)}
                      className={cn(
                        "text-left border rounded-lg p-3 transition-colors",
                        selected
                          ? "border-primary ring-2 ring-primary/20 bg-accent"
                          : "hover:border-muted-foreground/50 hover:bg-[var(--canvas)]"
                      )}
                    >
                      <div className="flex justify-center mb-2 h-16 items-center">
                        <div
                          className="bg-[var(--canvas)] border"
                          style={{
                            width: aspect >= 1 ? 72 : Math.round(72 * aspect),
                            height: aspect >= 1 ? Math.round(72 / aspect) : 72,
                          }}
                        />
                      </div>
                      <div className="text-sm font-medium">{p.label}</div>
                      <div className="text-xs text-muted-foreground">{p.description}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            {isCustom && (
                <div className="grid grid-cols-2 gap-4 mt-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="cw">Width (px)</Label>
                    <Input id="cw" type="number" min={100} max={8000} value={customWidth} onChange={(e) => setCustomWidth(Number(e.target.value))} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="ch">Height (px)</Label>
                    <Input id="ch" type="number" min={100} max={8000} value={customHeight} onChange={(e) => setCustomHeight(Number(e.target.value))} />
                  </div>
                </div>
              )}

            <div className="max-w-xs space-y-1.5">
              <Label htmlFor="bg">Background Color</Label>
              <div className="flex gap-2 items-center">
                <input type="color" className="h-9 w-14 border rounded-md cursor-pointer" value={background} onChange={(e) => setBackground(e.target.value)} />
                <Input id="bg" type="text" className="flex-1 font-mono" value={background} onChange={(e) => setBackground(e.target.value)} />
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              Final canvas: <span className="font-mono">{width} × {height} px</span>
            </p>

            <Button type="submit" disabled={saving || !name.trim()} className="w-full">
              {saving ? "Creating…" : "Create & Open Editor"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
