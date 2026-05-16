import { useEffect, useRef, useState } from "react";
import type Konva from "konva";

const ROTATION_SNAPS = [0, 15, 30, 45, 60, 75, 90, 105, 120, 135, 150, 165, 180, 195, 210, 225, 240, 255, 270, 285, 300, 315, 330, 345];

export function useTransformer(isSelected: boolean) {
  const trRef = useRef<Konva.Transformer | null>(null);
  const nodeRef = useRef<Konva.Node | null>(null);
  const [shiftHeld, setShiftHeld] = useState(false);

  useEffect(() => {
    const onDown = (e: KeyboardEvent) => { if (e.key === "Shift") setShiftHeld(true); };
    const onUp = (e: KeyboardEvent) => { if (e.key === "Shift") setShiftHeld(false); };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
    };
  }, []);

  useEffect(() => {
    if (isSelected && trRef.current && nodeRef.current) {
      trRef.current.nodes([nodeRef.current]);
      trRef.current.getLayer()?.batchDraw();
    } else if (trRef.current) {
      trRef.current.nodes([]);
    }
  }, [isSelected]);

  return { trRef, nodeRef, rotationSnaps: shiftHeld ? ROTATION_SNAPS : [] };
}
