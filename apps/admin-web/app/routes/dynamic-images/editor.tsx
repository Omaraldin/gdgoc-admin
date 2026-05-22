import { useState, useCallback, useEffect, lazy, Suspense } from "react";
import { ClientOnly } from "~/components/ClientOnly";
import { useLoaderData, useNavigate } from "react-router";
import type { Route } from "./+types/editor";
import { getDynamicImage, updateDynamicImage } from "~/lib/api/dynamic-images";
import { uploadTemplateAsset } from "~/lib/api/templates";
import { apiClient } from "~/lib/api/client";
const CertificateEditor = lazy(() => import("~/components/editor/CertificateEditor").then(m => ({ default: m.CertificateEditor })));
import type { SceneDefinition } from "~/lib/types";

export function meta() {
    return [{ title: "Dynamic Image Editor | GDGoC Admin" }];
}

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
    const image = await getDynamicImage(params.id);
    return { image };
}

export default function DynamicImageEditorPage() {
    const { image } = useLoaderData<typeof clientLoader>();
    const navigate = useNavigate();

    const initialScene: SceneDefinition = (image.scene as SceneDefinition) ?? {
        width: 1200,
        height: 630,
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

    // Undo (Ctrl+Z) / Redo (Ctrl+Y or Ctrl+Shift+Z)
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
    const [name, setName] = useState(image.name);
    const [pendingFiles, setPendingFiles] = useState<Record<string, { file: File; blobUrl: string }>>({});
    const [transitionBlobs, setTransitionBlobs] = useState<Record<string, string>>({});
    const [uploadingCount, setUploadingCount] = useState(0);

    // We reuse the templates asset upload endpoint since dynamic images share the same storage.
    // Assets are keyed under a "dynamic-images/<id>/assets/..." path.
    const assetBaseUrl = `${import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8080/api/v1"}/assets`;

    const getImageUrl = (objectKey: string): string => {
        const pending = pendingFiles[objectKey];
        if (pending) return pending.blobUrl;
        const transitioning = transitionBlobs[objectKey];
        if (transitioning) return transitioning;
        return `${assetBaseUrl}/${objectKey}`;
    };

    const handleImageReady = (objectKey: string) => {
        setTransitionBlobs((prev) => {
            const blobUrl = prev[objectKey];
            if (blobUrl) URL.revokeObjectURL(blobUrl);
            const next = { ...prev };
            delete next[objectKey];
            return next;
        });
    };

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

            if (pending.length > 0) {
                setUploadingCount(pending.length);
                // Upload assets via the templates asset endpoint, reusing the same storage backend.
                // We upload against a well-known "dynamic-images" template placeholder.
                const uploads = await Promise.all(
                    pending.map(async ([tempKey, { file }]) => {
                        const form = new FormData();
                        form.append("file", file);
                        const res = await apiClient.post<{ object_key: string }>(
                            `/dynamic-images/${image.id}/assets`,
                            form,
                            { headers: { "Content-Type": "multipart/form-data" } },
                        );
                        return { tempKey, objectKey: res.data.object_key };
                    }),
                );
                setUploadingCount(0);

                const keyMap = Object.fromEntries(
                    uploads.map(({ tempKey, objectKey }) => [tempKey, objectKey]),
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

                const newTransitions: Record<string, string> = {};
                for (const { tempKey, objectKey } of uploads) {
                    const blobUrl = pendingFiles[tempKey]?.blobUrl;
                    if (blobUrl) newTransitions[objectKey] = blobUrl;
                }
                setTransitionBlobs((prev) => ({ ...prev, ...newTransitions }));
                setPendingFiles({});
                setScene(currentScene);
            }

            await updateDynamicImage(image.id, {
                name: name.trim() || image.name,
                description: image.description,
                scene: currentScene,
            });
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
                    <button
                        onClick={() => navigate(`/dynamic-images/${image.id}`)}
                        className="text-text-2 hover:text-text-1"
                    >
                        ← Back
                    </button>
                    <input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className="font-semibold bg-transparent border-b border-transparent hover:border-border focus:border-border focus:outline-none px-0.5 min-w-0 max-w-xs"
                        aria-label="Image name"
                    />
                    <span className="text-xs text-text-3">
                        Dynamic Image · {scene.width} × {scene.height}
                        {Object.keys(pendingFiles).length > 0 && (
                            <span className="ml-2 text-orange-500">
                                ● {Object.keys(pendingFiles).length} unsaved
                            </span>
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
                                : "Save"}
                    </button>
                </div>
            </header>

            <div className="flex-1 overflow-hidden flex flex-col">
                <ClientOnly fallback={<div className="flex-1 flex items-center justify-center text-muted-foreground">Loading editor...</div>}>
                    {() => (
                        <Suspense fallback={<div className="flex-1 flex items-center justify-center text-muted-foreground">Loading editor...</div>}>
                            <CertificateEditor
                                scene={scene}
                                onChange={setScene}
                                assetBaseUrl={assetBaseUrl}
                                getImageUrl={getImageUrl}
                                onAddImageFile={handleAddImageFile}
                                onImageReady={handleImageReady}
                            />
                        </Suspense>
                    )}
                </ClientOnly>
            </div>
        </div>
    );
}
