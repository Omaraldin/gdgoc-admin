import { useEffect, useRef } from "react";
import { Image as KonvaImage, Transformer } from "react-konva";
import type Konva from "konva";
import useImage from "use-image";
import type { Layer as LayerModel } from "~/lib/types";
import { EMPTY_GUIDES, type GetSnapResult, type GuideLines } from "./types";
import { useTransformer } from "./useTransformer";

interface EditorImageNodeProps {
  layer: LayerModel;
  assetBaseUrl: string;
  getImageUrl: (objectKey: string) => string;
  onImageReady: (objectKey: string) => void;
  isSelected: boolean;
  isMultiSelected: boolean;
  registerNode: (id: string, node: Konva.Node | null) => void;
  onGroupDragStart: (sourceId: string) => void;
  onGroupDragMove: (sourceId: string, x: number, y: number) => void;
  onGroupDragEnd: (sourceId: string, x: number, y: number) => void;
  onSelect: () => void;
  onUpdate: (u: Partial<LayerModel>) => void;
  getSnapResult: GetSnapResult;
  setGuides: React.Dispatch<React.SetStateAction<GuideLines>>;
}

export function EditorImageNode({
  layer,
  assetBaseUrl,
  getImageUrl,
  onImageReady,
  isSelected,
  isMultiSelected,
  registerNode,
  onGroupDragStart,
  onGroupDragMove,
  onGroupDragEnd,
  onSelect,
  onUpdate,
  getSnapResult,
  setGuides,
}: EditorImageNodeProps) {
  const objectKey = layer.image_props!.asset_key;
  const displayUrl = getImageUrl(objectKey);
  const isTransitioning = displayUrl.startsWith("blob:");
  const remoteUrl = `${assetBaseUrl}/${objectKey}`;

  const [img] = useImage(displayUrl, "anonymous");
  const [remoteImg, remoteStatus] = useImage(isTransitioning ? remoteUrl : "", "anonymous");

  const notifiedRef = useRef(false);
  useEffect(() => {
    if (isTransitioning && remoteStatus === "loaded" && !notifiedRef.current) {
      notifiedRef.current = true;
      onImageReady(objectKey);
    }
    if (!isTransitioning) notifiedRef.current = false;
  }, [isTransitioning, remoteStatus, objectKey, onImageReady]);

  const displayImg = isTransitioning && remoteStatus === "loaded" ? remoteImg : img;
  const { trRef, nodeRef, rotationSnaps } = useTransformer(isSelected && !isMultiSelected);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    registerNode(layer.id, nodeRef.current);
    return () => registerNode(layer.id, null);
  }, [layer.id, registerNode]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <KonvaImage
        ref={nodeRef as React.Ref<Konva.Image>}
        image={displayImg}
        x={layer.x}
        y={layer.y}
        offsetX={layer.width / 2}
        offsetY={layer.height / 2}
        width={layer.width}
        height={layer.height}
        rotation={layer.rotation}
        draggable={isSelected}
        onClick={onSelect}
        onTap={onSelect}
        onDragStart={(e) => {
          dragStartRef.current = { x: e.target.x(), y: e.target.y() };
          if (isMultiSelected) onGroupDragStart(layer.id);
        }}
        onDragMove={(e) => {
          const node = e.target;
          if (!isMultiSelected) {
            let axisLock: "x" | "y" | null = null;
            if (e.evt.shiftKey && dragStartRef.current) {
              const dx = Math.abs(node.x() - dragStartRef.current.x);
              const dy = Math.abs(node.y() - dragStartRef.current.y);
              if (dx >= dy) { axisLock = "x"; node.y(dragStartRef.current.y); }
              else { axisLock = "y"; node.x(dragStartRef.current.x); }
            }
            const { snapX, snapY, guides } = getSnapResult(node.x(), node.y(), node.width(), node.height(), layer.id);
            if (snapX !== null && axisLock !== "y") node.x(snapX);
            if (snapY !== null && axisLock !== "x") node.y(snapY);
            setGuides(guides);
          }
          if (isMultiSelected) onGroupDragMove(layer.id, node.x(), node.y());
        }}
        onDragEnd={(e) => {
          setGuides(EMPTY_GUIDES);
          if (isMultiSelected) {
            onGroupDragEnd(layer.id, e.target.x(), e.target.y());
          } else {
            onUpdate({ x: e.target.x(), y: e.target.y() });
          }
        }}
        onTransformEnd={(e) => {
          const node = e.target as Konva.Image;
          const scaleX = node.scaleX();
          const scaleY = node.scaleY();
          node.scaleX(1);
          node.scaleY(1);
          onUpdate({
            x: node.x(),
            y: node.y(),
            width: Math.max(10, node.width() * scaleX),
            height: Math.max(10, node.height() * scaleY),
            rotation: node.rotation(),
          });
        }}
      />
      {isSelected && !isMultiSelected && (
        <Transformer
          ref={trRef as React.Ref<Konva.Transformer>}
          rotateEnabled
          rotationSnaps={rotationSnaps}
          boundBoxFunc={(oldBox, newBox) => (newBox.width < 10 || newBox.height < 10 ? oldBox : newBox)}
        />
      )}
    </>
  );
}
