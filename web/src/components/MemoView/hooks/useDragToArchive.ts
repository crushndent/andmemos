import { type PointerEvent as ReactPointerEvent, type RefObject, useCallback, useRef } from "react";

/** Horizontal movement before a press becomes a drag, so ordinary clicks and taps never move a card. */
export const DRAG_START_THRESHOLD_PX = 8;
/** A leftward drag past this fraction of the card's width archives it on release. */
export const ARCHIVE_DRAG_WIDTH_RATIO = 0.4;
/** Never require less than this many pixels, so narrow cards are not archived by a nudge. */
export const ARCHIVE_DRAG_MIN_DISTANCE_PX = 96;
/** Releasing the pointer this close to the window's left border archives regardless of distance. */
export const ARCHIVE_EDGE_ZONE_PX = 24;

const INTERACTIVE_SELECTOR = "a, button, input, textarea, select, video, audio, [role='button'], [contenteditable='true']";

interface ArchiveReleaseInput {
  /** Horizontal drag distance in px; negative is leftward. */
  deltaX: number;
  cardWidth: number;
  /** Pointer x relative to the window's left border. */
  pointerX: number;
}

/** Decides whether releasing the pointer here should archive the card. */
export const shouldArchiveOnRelease = ({ deltaX, cardWidth, pointerX }: ArchiveReleaseInput): boolean => {
  if (deltaX >= 0) return false;
  if (pointerX <= ARCHIVE_EDGE_ZONE_PX) return true;
  const distance = Math.max(ARCHIVE_DRAG_MIN_DISTANCE_PX, cardWidth * ARCHIVE_DRAG_WIDTH_RATIO);
  return -deltaX >= distance;
};

interface UseDragToArchiveOptions {
  cardRef: RefObject<HTMLElement | null>;
  enabled: boolean;
  /** Resolves true once the memo is archived; false leaves the card in place. */
  onArchive: () => Promise<boolean>;
}

interface DragState {
  pointerId: number;
  startX: number;
  startY: number;
  dragging: boolean;
  width: number;
}

const resetCardStyle = (card: HTMLElement) => {
  card.style.transition = "transform 150ms ease-out, opacity 150ms ease-out";
  card.style.transform = "";
  card.style.opacity = "";
  card.style.userSelect = "";
};

/**
 * Drag a card to the left to archive it, Google-Keep style. Movement is applied straight to the
 * card's style (no React state), so a drag never re-renders the feed. Releasing past the distance
 * threshold — or at the window's left border — archives immediately, with no confirmation.
 */
export const useDragToArchive = ({ cardRef, enabled, onArchive }: UseDragToArchiveOptions) => {
  const stateRef = useRef<DragState | null>(null);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (!enabled || !event.isPrimary || (event.pointerType === "mouse" && event.button !== 0)) return;
      if (event.target instanceof Element && event.target.closest(INTERACTIVE_SELECTOR)) return;
      stateRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        dragging: false,
        width: event.currentTarget.getBoundingClientRect().width,
      };
    },
    [enabled],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const state = stateRef.current;
      const card = cardRef.current;
      if (!state || !card || state.pointerId !== event.pointerId) return;
      const deltaX = event.clientX - state.startX;
      const deltaY = event.clientY - state.startY;

      if (!state.dragging) {
        // A vertical gesture is a scroll; a rightward one is not ours. Give up on both.
        if (Math.abs(deltaY) > DRAG_START_THRESHOLD_PX && Math.abs(deltaY) > Math.abs(deltaX)) {
          stateRef.current = null;
          return;
        }
        if (deltaX > -DRAG_START_THRESHOLD_PX) return;
        state.dragging = true;
        card.setPointerCapture?.(event.pointerId);
        card.style.transition = "none";
        card.style.userSelect = "none";
        window.getSelection?.()?.removeAllRanges();
      }

      const offset = Math.min(0, deltaX);
      card.style.transform = `translateX(${offset}px)`;
      card.style.opacity = String(Math.max(0.3, 1 - Math.abs(offset) / (state.width * 1.2)));
    },
    [cardRef],
  );

  const finish = useCallback(
    (event: ReactPointerEvent<HTMLElement>, cancelled: boolean) => {
      const state = stateRef.current;
      const card = cardRef.current;
      if (!state || state.pointerId !== event.pointerId) return;
      stateRef.current = null;
      if (!card || !state.dragging) return;

      card.releasePointerCapture?.(event.pointerId);
      // The release ends a drag, not a click: swallow the click the browser may still dispatch.
      const swallow = (clickEvent: Event) => clickEvent.stopPropagation();
      card.addEventListener("click", swallow, true);
      setTimeout(() => card.removeEventListener("click", swallow, true), 0);

      const archive =
        !cancelled && shouldArchiveOnRelease({ deltaX: event.clientX - state.startX, cardWidth: state.width, pointerX: event.clientX });
      if (archive) {
        card.style.transition = "transform 150ms ease-in, opacity 150ms ease-in";
        card.style.transform = `translateX(-${state.width}px)`;
        card.style.opacity = "0";
        void onArchive().then((archived) => {
          // A failed archive leaves the card in the feed; bring it back.
          if (!archived && card.isConnected) resetCardStyle(card);
        });
      } else {
        resetCardStyle(card);
      }
    },
    [cardRef, onArchive],
  );

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: useCallback((event: ReactPointerEvent<HTMLElement>) => finish(event, false), [finish]),
    onPointerCancel: useCallback((event: ReactPointerEvent<HTMLElement>) => finish(event, true), [finish]),
  };
};
