import type { TargetKind, TrackInput } from "@smart-renderers/core";
import {
  createContentsHandle,
  type BrowserWindowLike,
  type TargetHandle,
  type WebContentsLike,
} from "@smart-renderers/manager";

export type AttachableContents = WebContentsLike & {
  id: number;
};

export type AttachTarget = {
  track(input: TrackInput, handle?: TargetHandle): void;
  untrack(id: string): void;
};

export function attachContents(
  target: AttachTarget,
  contents: AttachableContents,
  window?: BrowserWindowLike,
  kind: TargetKind = "window",
): () => void {
  const id = String(contents.id);
  target.track(
    { id, pid: process.pid, kind },
    createContentsHandle(contents, window, kind),
  );
  return () => {
    target.untrack(id);
  };
}
