import { useCallback, useState } from "react";
import { BOARD_LAYOUT_STORAGE_KEY, type BoardLayout, parseBoardLayout, withBoard, withList, withListMoved } from "@/lib/board";

const readLayout = (): BoardLayout => {
  try {
    return parseBoardLayout(localStorage.getItem(BOARD_LAYOUT_STORAGE_KEY));
  } catch {
    return parseBoardLayout(null);
  }
};

/**
 * Board structure that tags alone cannot express: boards and lists with no cards yet, and the
 * left-to-right order of lists. Kept in this browser; the cards themselves live in memos.
 */
export const useBoardLayout = () => {
  const [layout, setLayout] = useState<BoardLayout>(readLayout);

  const update = useCallback((change: (current: BoardLayout) => BoardLayout) => {
    setLayout((current) => {
      const next = change(current);
      if (next === current) return current;
      try {
        localStorage.setItem(BOARD_LAYOUT_STORAGE_KEY, JSON.stringify(next));
      } catch (error) {
        console.warn("Failed to persist board layout:", error);
      }
      return next;
    });
  }, []);

  const addBoard = useCallback((board: string) => update((current) => withBoard(current, board)), [update]);
  const addList = useCallback(
    (board: string, list: string, currentOrder: readonly string[]) => update((current) => withList(current, board, list, currentOrder)),
    [update],
  );
  const moveList = useCallback(
    (board: string, list: string, direction: -1 | 1, currentOrder: readonly string[]) =>
      update((current) => withListMoved(current, board, list, direction, currentOrder)),
    [update],
  );

  return { layout, addBoard, addList, moveList };
};
