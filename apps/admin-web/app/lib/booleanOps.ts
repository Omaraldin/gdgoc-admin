/**
 * Boolean path operations powered by paper.js, lazy-loaded so the engine is
 * only fetched when the user actually uses unite / subtract / intersect / exclude.
 *
 * Operates on our PathProps shape: anchor list ↔ paper.Path/CompoundPath.
 *
 * Paper.js requires a Project context. We use a headless setup() so it never
 * touches the DOM.
 */

import type { PathProps, SubPath, PathAnchor, FillRule } from "./types";
import { makeAnchor } from "./pathUtils";
// paper.js declares a global `paper` namespace with all type names
// (Path, PathItem, Segment, etc.), separate from its module export.
// We can refer to these types without importing.

export type BooleanOp = "unite" | "subtract" | "intersect" | "exclude";

let paperPromise: Promise<paper.PaperScope> | null = null;

async function getPaper(): Promise<paper.PaperScope> {
  if (!paperPromise) {
    paperPromise = import("paper").then((mod) => {
      const p = (mod as unknown as { default: paper.PaperScope }).default;
      const canvas =
        typeof document !== "undefined"
          ? document.createElement("canvas")
          : undefined;
      if (canvas) {
        canvas.width = 1;
        canvas.height = 1;
        p.setup(canvas);
      } else {
        // Node / SSR fallback.
        p.setup([1, 1] as unknown as HTMLCanvasElement);
      }
      return p;
    });
  }
  return paperPromise;
}

// ---------- PathProps ↔ paper.PathItem ----------

function pathPropsToPaperItem(
  paperScope: paper.PaperScope,
  props: PathProps,
): paper.PathItem {
  const subPaths: paper.Path[] = props.subpaths
    .filter((s) => s.anchors.length > 0)
    .map((sp) => {
      const path = new paperScope.Path();
      path.closed = sp.closed;
      for (const a of sp.anchors) {
        const segment = new paperScope.Segment(
          new paperScope.Point(a.x, a.y),
          new paperScope.Point(a.hi_x, a.hi_y),
          new paperScope.Point(a.ho_x, a.ho_y),
        );
        path.add(segment);
      }
      return path;
    });
  if (subPaths.length === 0) return new paperScope.Path();
  if (subPaths.length === 1) return subPaths[0]!;
  return new paperScope.CompoundPath({ children: subPaths });
}

function paperItemToPathProps(
  item: paper.PathItem,
  fillRule: FillRule,
): PathProps {
  const subpaths: SubPath[] = [];
  const collectPath = (p: paper.Path) => {
    if (!p.segments || p.segments.length === 0) return;
    const anchors: PathAnchor[] = p.segments.map((s: paper.Segment) =>
      makeAnchor(
        s.point.x,
        s.point.y,
        { x: s.handleIn.x, y: s.handleIn.y },
        { x: s.handleOut.x, y: s.handleOut.y },
      ),
    );
    subpaths.push({ closed: p.closed, anchors });
  };
  // CompoundPath has children; Path has segments directly.
  const className = (item as unknown as { className?: string }).className;
  if (className === "CompoundPath") {
    const children = (item as unknown as { children: paper.Path[] }).children;
    for (const c of children) collectPath(c);
  } else {
    collectPath(item as unknown as paper.Path);
  }
  return { subpaths, fill_rule: fillRule };
}

/** Run a boolean op across N PathProps (left-fold). Returns a new normalized PathProps. */
export async function booleanOp(
  op: BooleanOp,
  inputs: PathProps[],
): Promise<PathProps> {
  if (inputs.length < 2) {
    return inputs[0] ?? { subpaths: [], fill_rule: "nonzero" };
  }
  const paperScope = await getPaper();
  let acc = pathPropsToPaperItem(paperScope, inputs[0]!);
  for (let i = 1; i < inputs.length; i++) {
    const next = pathPropsToPaperItem(paperScope, inputs[i]!);
    let result: paper.PathItem;
    switch (op) {
      case "unite":
        result = acc.unite(next);
        break;
      case "subtract":
        result = acc.subtract(next);
        break;
      case "intersect":
        result = acc.intersect(next);
        break;
      case "exclude":
        result = acc.exclude(next);
        break;
    }
    acc.remove();
    next.remove();
    acc = result;
  }
  const fillRule = inputs[0]!.fill_rule;
  const out = paperItemToPathProps(acc, fillRule);
  acc.remove();
  return out;
}
