import { useState } from "react";
import { useNavigate } from "react-router";
import { createDynamicImage } from "~/lib/api/dynamic-images";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import { Card, CardContent } from "~/components/ui/card";
import { cn } from "~/lib/utils";

export function meta() {
  return [{ title: "New Dynamic Image | GDGoC Admin" }];
}

type Preset = {
  id: string;
  label: string;
  description: string;
  width: number;
  height: number;
};

const PRESETS: Preset[] = [
  { id: "a4-landscape", label: "A4 Landscape", description: "1754 × 1240 px", width: 1754, height: 1240 },
  { id: "a4-portrait", label: "A4 Portrait", description: "1240 × 1754 px", width: 1240, height: 1754 },
  { id: "social", label: "Social Card", description: "1200 × 630 px", width: 1200, height: 630 },
  { id: "square", label: "Square", description: "1080 × 1080 px", width: 1080, height: 1080 },
  { id: "custom", label: "Custom", description: "Enter your own dimensions", width: 1280, height: 720 },
];

export default function NewDynamicImagePage() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [presetId, setPresetId] = useState<string>("social");
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
      const img = await createDynamicImage({
        name,
        description,
        scene: { width, height, background, layers: [] },
      });
      navigate(`/dynamic-images/${img.id}/editor`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-4 sm:p-8 max-w-3xl mx-auto">
      <h1 className="text-xl font-semibold mb-6 text-foreground">New Dynamic Image</h1>
      <Card>
        <CardContent className="p-6">
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-1.5">
              <Label htmlFor="di-name">Name *</Label>
              <Input
                id="di-name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Event Banner"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="di-desc">Description</Label>
              <Textarea
                id="di-desc"
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional description"
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
                          : "hover:border-muted-foreground/50",
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
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="di-cw">Width (px)</Label>
                  <Input
                    id="di-cw"
                    type="number"
                    min={100}
                    max={8000}
                    value={customWidth}
                    onChange={(e) => setCustomWidth(Number(e.target.value))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="di-ch">Height (px)</Label>
                  <Input
                    id="di-ch"
                    type="number"
                    min={100}
                    max={8000}
                    value={customHeight}
                    onChange={(e) => setCustomHeight(Number(e.target.value))}
                  />
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="di-bg">Background Color</Label>
              <div className="flex items-center gap-3">
                <input
                  id="di-bg"
                  type="color"
                  value={background}
                  onChange={(e) => setBackground(e.target.value)}
                  className="w-10 h-10 rounded cursor-pointer border"
                />
                <span className="text-sm text-muted-foreground">{background}</span>
              </div>
            </div>

            <div className="flex justify-end gap-3">
              <Button type="button" variant="outline" onClick={() => navigate("/dynamic-images")}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? "Creating…" : "Create & Open Editor"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
