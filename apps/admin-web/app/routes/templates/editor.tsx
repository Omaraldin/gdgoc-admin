import { useState, useCallback, useEffect } from "react";
import { useLoaderData, useNavigate } from "react-router";
import type { Route } from "./+types/editor";
import { getTemplate, listTemplateVersions, uploadTemplateAsset, updateTemplateMeta } from "~/lib/api/templates";
import { apiClient } from "~/lib/api/client";
import { CertificateEditor } from "~/components/editor/CertificateEditor";
import type { SceneDefinition } from "~/lib/types";

export function meta() {
  return [{ title: "Template Editor | GDGoC Admin" }];
}

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
    if (params.id) {
        const [template, versions] = await Promise.all([
            getTemplate(params.id),
            listTemplateVersions(params.id),
        ]);
        return { template, versions };
    }
    return { template: null, versions: [] };
}

export default function TemplateEditorPage() {
    const { template, versions } = useLoaderData<typeof clientLoader>();
    const navigate = useNavigate();

    const latestVersion = versions[0];

    const initialScene: SceneDefinition = latestVersion?.scene ?? {
        width: 1754,
        height: 1240,
        background: "#ffffff",
        layers: [],
    };

    const [historyState, setHistoryState] = useState<{ scenes: SceneDefinition[]; index: number }>(
        { scenes: [initialScene], index: 0 },
    );
    const scene = historyState.scenes[historyState.index]!;

    const setScene = useCallback((newScene: SceneDefinition) => {
        setHistoryState((prev) => ({
            scenes: [...prev.scenes.slice(0, prev.index + 1), newScene],
            index: prev.index + 1,
        }));
    }, []);

    // Undo (Ctrl+Z) / Redo (Ctrl+Y or Ctrl+Shift+Z).
    useEffect(() => {
        const handleKey = (e: KeyboardEvent) => {
            const target = e.target as HTMLElement;
            if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
            if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === "z") {
                e.preventDefault();
                setHistoryState((prev) => ({ ...prev, index: Math.max(0, prev.index - 1) }));
            } else if (e.ctrlKey && (e.key.toLowerCase() === "y" || (e.shiftKey && e.key.toLowerCase() === "z"))) {
                e.preventDefault();
                setHistoryState((prev) => ({ ...prev, index: Math.min(prev.scenes.length - 1, prev.index + 1) }));
            }
        };
        window.addEventListener("keydown", handleKey);
        return () => window.removeEventListener("keydown", handleKey);
    }, []);

    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [name, setName] = useState(template?.name ?? "");
    const [pendingFiles, setPendingFiles] = useState<Record<string, { file: File; blobUrl: string }>>({});
    // After upload: maps real objectKey → blob URL until the real image finishes loading.
    const [transitionBlobs, setTransitionBlobs] = useState<Record<string, string>>({});
    const [uploadingCount, setUploadingCount] = useState(0);

    const assetBaseUrl = `${import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8080/api/v1"}/assets`;

    // Resolve display URL: blob for pending/transitioning images, API URL once ready.
    const getImageUrl = (objectKey: string): string => {
        const pending = pendingFiles[objectKey];
        if (pending) return pending.blobUrl;
        const transitioning = transitionBlobs[objectKey];
        if (transitioning) return transitioning;
        return `${assetBaseUrl}/${objectKey}`;
    };

    // Called once the real remote image has fully loaded for a given key.
    const handleImageReady = (objectKey: string) => {
        setTransitionBlobs((prev) => {
            const blobUrl = prev[objectKey];
            if (blobUrl) URL.revokeObjectURL(blobUrl);
            const next = { ...prev };
            delete next[objectKey];
            return next;
        });
    };

    // Called synchronously when user picks a file — registers it locally, no upload yet.
    const handleAddImageFile = (file: File): string => {
        const tempKey = `temp:${crypto.randomUUID()}`;
        const blobUrl = URL.createObjectURL(file);
        setPendingFiles((prev) => ({ ...prev, [tempKey]: { file, blobUrl } }));
        return tempKey;
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            let currentScene = scene;
            const pending = Object.entries(pendingFiles);

            // Upload any pending images first, then replace their temp keys in the scene.
            if (pending.length > 0) {
                setUploadingCount(pending.length);
                const uploads = await Promise.all(
                    pending.map(async ([tempKey, { file }]) => {
                        if (template?.id) {
                            const asset = await uploadTemplateAsset(template?.id, file);
                            return { tempKey, objectKey: asset.object_key };
                        }
                        throw new Error("Template ID is required to upload assets");
                    }),
                );
                setUploadingCount(0);

                const keyMap = Object.fromEntries(
                    uploads?.map(({ tempKey, objectKey }) => [tempKey, objectKey]),
                );

                currentScene = {
                    ...currentScene,
                    layers: currentScene.layers.map((layer) => {
                        if (layer.type === "image" && layer.image_props?.asset_key) {
                            const realKey = keyMap[layer.image_props.asset_key];
                            if (realKey) {
                                return { ...layer, image_props: { ...layer.image_props, asset_key: realKey } };
                            }
                        }
                        return layer;
                    }),
                };

                // Move blob URLs into transitionBlobs keyed by real objectKey.
                // The blob stays alive until the remote image finishes loading (handleImageReady).
                const newTransitions: Record<string, string> = {};
                for (const { tempKey, objectKey } of uploads) {
                    const blobUrl = pendingFiles[tempKey]?.blobUrl;
                    if (blobUrl) newTransitions[objectKey] = blobUrl;
                }
                setTransitionBlobs((prev) => ({ ...prev, ...newTransitions }));
                setPendingFiles({});
                setScene(currentScene);
            }

            await apiClient.post(`/templates/${template?.id}/versions`, { scene: currentScene });
            if (template?.id && name.trim() && name.trim() !== template.name) {
                await updateTemplateMeta(template.id, { name: name.trim(), description: template.description });
            }
            setSaved(true);
            setTimeout(() => setSaved(false), 2000);
        } finally {
            setSaving(false);
            setUploadingCount(0);
        }
    };

    return (
        <div className="flex flex-col h-screen">
            <header className="flex items-center justify-between px-6 py-3 border-b bg-surface">
                <div className="flex items-center gap-3">
                    <button onClick={() => navigate(`/templates/${template?.id}`)} className="text-text-2 hover:text-text-1">
                        ← Back
                    </button>
                    <input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className="font-semibold bg-transparent border-b border-transparent hover:border-border focus:border-border focus:outline-none px-0.5 min-w-0 max-w-xs"
                        aria-label="Template name"
                    />
                    <span className="text-xs text-text-3">
                        Editor · {scene.width} × {scene.height}
                        {Object.keys(pendingFiles).length > 0 && (
                            <span className="ml-2 text-orange-500">● {Object.keys(pendingFiles).length} unsaved</span>
                        )}
                    </span>
                </div>

                <div className="flex items-center gap-3">
                    <button
                        onClick={handleSave}
                        disabled={saving}
                        className="px-4 py-1.5 bg-g-blue text-white text-sm rounded hover:bg-g-blue-hover disabled:opacity-50"
                    >
                        {saving
                            ? uploadingCount > 0
                                ? `Uploading ${uploadingCount}…`
                                : "Saving…"
                            : saved
                                ? "Saved ✓"
                                : "Save Version"}
                    </button>
                </div>
            </header>

            <div className="flex-1 overflow-hidden">
                <CertificateEditor
                    scene={scene}
                    onChange={setScene}
                    assetBaseUrl={assetBaseUrl}
                    getImageUrl={getImageUrl}
                    onAddImageFile={handleAddImageFile}
                    onImageReady={handleImageReady}
                />
            </div>
        </div>
    );
}
