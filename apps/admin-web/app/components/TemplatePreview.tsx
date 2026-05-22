import { useEffect, useState, useRef } from "react";
import { Stage, Layer, Rect } from "react-konva";
import { getTemplateVersion } from "~/lib/api/templates";
import type { SceneDefinition } from "~/lib/types";
import { EditorTextNode } from "./editor/EditorTextNode";
import { EditorImageNode } from "./editor/EditorImageNode";
import { EditorShapeNode } from "./editor/EditorShapeNode";
import { EditorQrNode } from "./editor/EditorQrNode";
import { PathRenderer } from "./editor/PathRenderer";

interface TemplatePreviewProps {
  templateId: string;
  versionId: string | null;
}

const ASSET_BASE_URL = `${import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8080/api/v1"}/assets`;
const EMPTY_GUIDES = { vertical: [], horizontal: [] };
const DUMMY_SNAP_RESULT = { snapX: null, snapY: null, guides: EMPTY_GUIDES };

export function TemplatePreview({ templateId, versionId }: TemplatePreviewProps) {
  const [scene, setScene] = useState<SceneDefinition | null>(null);
  const [error, setError] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    if (!versionId) return;
    let mounted = true;
    getTemplateVersion(templateId, versionId)
      .then((v) => {
        if (mounted) setScene(v.scene);
      })
      .catch((e) => {
        console.error("Failed to load template version", e);
        if (mounted) setError(true);
      });
    return () => { mounted = false; };
  }, [templateId, versionId]);

  useEffect(() => {
    if (!scene || !containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      const z = Math.min(width / scene.width, height / scene.height);
      setZoom(z);
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [scene]);

  if (error || !versionId) {
    return <div className="w-full aspect-video bg-muted flex items-center justify-center text-muted-foreground text-xs">Preview unavailable</div>;
  }

  if (!scene) {
    return <div className="w-full aspect-video bg-muted animate-pulse" />;
  }

  const sortedLayers = [...scene.layers].sort((a, b) => a.z_index - b.z_index);

  return (
    <div ref={containerRef} className="w-full aspect-video relative bg-muted flex items-center justify-center overflow-hidden">
      <Stage
        width={scene.width * zoom}
        height={scene.height * zoom}
        scaleX={zoom}
        scaleY={zoom}
        listening={false} // Disable all interactions to act as a static image
      >
        <Layer>
          <Rect width={scene.width} height={scene.height} fill={scene.background || "#ffffff"} />
          {sortedLayers.filter((l) => l.visible !== false).map((layer) => {
            const groupDragProps = {
              isMultiSelected: false,
              registerNode: () => {},
              onGroupDragStart: () => {},
              onGroupDragMove: () => {},
              onGroupDragEnd: () => {},
            };
            const commonProps = {
              isSelected: false,
              onSelect: () => {},
              onUpdate: () => {},
              getSnapResult: () => DUMMY_SNAP_RESULT,
              setGuides: () => {},
              ...groupDragProps,
            };

            if (layer.type === "text" && layer.text_props) {
              return <EditorTextNode key={layer.id} layer={layer} {...commonProps} />;
            }
            if (layer.type === "image" && layer.image_props) {
              return (
                <EditorImageNode
                  key={layer.id}
                  layer={layer}
                  assetBaseUrl={ASSET_BASE_URL}
                  getImageUrl={(key) => `${ASSET_BASE_URL}/${key}`}
                  onImageReady={() => {}}
                  {...commonProps}
                />
              );
            }
            if (layer.type === "shape" && layer.shape_props) {
              if (layer.shape_props.kind === "path" && layer.shape_props.path_props) {
                return <PathRenderer key={layer.id} layer={layer} selectionDisabled={true} {...commonProps} />;
              }
              return <EditorShapeNode key={layer.id} layer={layer} {...commonProps} />;
            }
            if (layer.type === "qr" && layer.qr_props) {
              return <EditorQrNode key={layer.id} layer={layer} {...commonProps} />;
            }
            return null;
          })}
        </Layer>
      </Stage>
    </div>
  );
}
