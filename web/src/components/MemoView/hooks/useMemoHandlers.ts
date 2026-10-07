import { useCallback } from "react";
import { useInstance } from "@/contexts/InstanceContext";
import type { PreviewMediaItem } from "@/utils/media-item";
import { wasRecentlyDragged } from "./useDragToArchive";

/** Anything inside a note that does something of its own when clicked: links, tags, checkboxes, media, buttons. */
const INTERACTIVE_SELECTOR =
  "a, button, input, textarea, select, summary, label, video, audio, img, iframe, [role='button'], [role='link'], [data-no-edit], [class*='cursor-pointer']";

/** Whether a click at `target` is a plain click on a note's own text, as opposed to a control inside it or the end of a text selection or drag. */
export const isPlainContentClick = (
  event: Pick<MouseEvent, "target" | "button" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey">,
): boolean => {
  if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return false;
  const target = event.target;
  if (!(target instanceof Element) || target.closest(INTERACTIVE_SELECTOR)) return false;
  if (wasRecentlyDragged()) return false;
  // Finishing a text selection ends in a click too; the user is copying, not editing.
  return (window.getSelection()?.toString() ?? "") === "";
};

interface UseMemoHandlersOptions {
  readonly: boolean;
  openEditor: () => void;
  openPreview: (items: string | string[] | PreviewMediaItem[], index?: number) => void;
}

export const useMemoHandlers = (options: UseMemoHandlersOptions) => {
  const { readonly, openEditor, openPreview } = options;
  const { memoRelatedSetting } = useInstance();

  const handleMemoContentClick = useCallback(
    (e: React.MouseEvent) => {
      const targetEl = e.target as HTMLElement;
      if (targetEl.tagName === "IMG") {
        const linkElement = targetEl.closest("a");
        if (linkElement) return; // If image is inside a link, don't show preview
        const imgUrl = targetEl.getAttribute("src");
        if (imgUrl) openPreview(imgUrl);
        return;
      }
      if (!readonly && isPlainContentClick(e.nativeEvent)) openEditor();
    },
    [readonly, openEditor, openPreview],
  );

  const handleMemoContentDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      if (readonly) return;
      if (memoRelatedSetting.enableDoubleClickEdit) {
        e.preventDefault();
        openEditor();
      }
    },
    [readonly, openEditor, memoRelatedSetting.enableDoubleClickEdit],
  );

  return { handleMemoContentClick, handleMemoContentDoubleClick };
};
