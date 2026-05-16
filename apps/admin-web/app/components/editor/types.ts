import type { Layer as LayerModel, SceneDefinition } from "~/lib/types";
import type { ToolMode } from "./PathOverlay";

export interface EditorProps {
  scene: SceneDefinition;
  onChange: (scene: SceneDefinition) => void;
  assetBaseUrl: string;
  getImageUrl: (objectKey: string) => string;
  onAddImageFile: (file: File) => string;
  onImageReady: (objectKey: string) => void;
}

export interface GuideLines {
  vertical: number[];
  horizontal: number[];
}

export const EMPTY_GUIDES: GuideLines = { vertical: [], horizontal: [] };

export type SnapResult = { snapX: number | null; snapY: number | null; guides: GuideLines };

export type GetSnapResult = (
  cx: number,
  cy: number,
  w: number,
  h: number,
  id: string,
) => SnapResult;

export interface EditorState {
  selectedId: string | null;
  extraSelectedIds: string[];
  toolMode: ToolMode;
  zoom: number;
}
