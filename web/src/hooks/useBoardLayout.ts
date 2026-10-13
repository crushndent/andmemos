import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useCurrentUser from "@/hooks/useCurrentUser";
import { memoKeys, useCreateMemo, useInfiniteMemos, useUpdateMemo } from "@/hooks/useMemoQueries";
import {
  BOARD_LAYOUT_FILTER,
  BOARD_LAYOUT_STORAGE_KEY,
  type BoardLayout,
  changedLayoutBoards,
  formatLayoutMemo,
  getLayoutMemos,
  layoutFromMemos,
  mergeLayouts,
  parseBoardLayout,
  withBoard,
  withList,
  withListMoved,
  withListsRemembered,
  withoutList,
} from "@/lib/board";
import { combineCELFilters } from "@/lib/cel-filter";
import { buildMemoCreatorFilter } from "@/lib/resource-names";
import { type Memo, Visibility } from "@/types/proto/api/v1/memo_service_pb";

/** Set once this browser's old local-only layout has been uploaded to the layout memos. */
const UPLOADED_KEY = "memos-board-layout-uploaded";

const readStorage = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

const writeStorage = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch (error) {
    console.warn("Failed to cache board layout:", error);
  }
};

/**
 * Board structure that tags alone cannot express: boards and lists with no cards yet, and the left-to-right
 * order of lists. It lives in the signed-in user's `#board-layout` memos (one per board), so every client
 * shares it; this browser keeps a copy only to draw the board before they load. The cards themselves live in
 * their own memos.
 */
export const useBoardLayout = () => {
  const currentUser = useCurrentUser();
  const queryClient = useQueryClient();
  const createMemo = useCreateMemo();
  const updateMemo = useUpdateMemo();

  const { data, isSuccess, hasNextPage, isFetchingNextPage, fetchNextPage } = useInfiniteMemos(
    { filter: combineCELFilters(BOARD_LAYOUT_FILTER, buildMemoCreatorFilter(currentUser?.name ?? "")), pageSize: 100 },
    { enabled: !!currentUser?.name },
  );
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const memos = useMemo(() => data?.pages.flatMap((page) => page.memos) ?? [], [data]);
  const loaded = isSuccess && !hasNextPage;
  const serverLayout = useMemo(() => layoutFromMemos(memos), [memos]);

  // Edits show at once and stay until the memos they wrote have been read back.
  const [optimistic, setOptimistic] = useState<BoardLayout | null>(null);
  const cached = useMemo(() => parseBoardLayout(readStorage(BOARD_LAYOUT_STORAGE_KEY)), []);
  const layout = optimistic ?? (loaded ? serverLayout : cached);

  useEffect(() => {
    if (loaded) writeStorage(BOARD_LAYOUT_STORAGE_KEY, JSON.stringify(serverLayout));
  }, [loaded, serverLayout]);

  // Writes run one at a time, so a board's memo is created once even when edits come quickly.
  const memosByBoard = useRef(new Map<string, Memo>());
  memosByBoard.current = getLayoutMemos(memos);
  const created = useRef(new Map<string, Memo>());
  const queue = useRef<Promise<void>>(Promise.resolve());
  const pendingWrites = useRef(0);

  const write = useCallback(
    (boards: string[], next: BoardLayout) => {
      if (boards.length === 0) return;
      pendingWrites.current += 1;
      queue.current = queue.current
        .then(async () => {
          for (const board of boards) {
            const content = formatLayoutMemo(board, next.lists[board] ?? []);
            const existing = memosByBoard.current.get(board) ?? created.current.get(board);
            if (existing) {
              if (existing.content !== content)
                await updateMemo.mutateAsync({ update: { name: existing.name, content }, updateMask: ["content"] });
            } else {
              const memo = await createMemo.mutateAsync({ content, visibility: Visibility.PRIVATE } as Memo);
              created.current.set(board, memo);
            }
          }
        })
        .catch((error) => console.warn("Failed to save board layout:", error))
        .finally(async () => {
          pendingWrites.current -= 1;
          if (pendingWrites.current > 0) return;
          await queryClient.invalidateQueries({ queryKey: memoKeys.lists() });
          setOptimistic(null);
        });
    },
    [createMemo, updateMemo, queryClient],
  );

  const latest = useRef(layout);
  latest.current = layout;
  const update = useCallback(
    (change: (current: BoardLayout) => BoardLayout) => {
      // Writing before the shared layout has loaded would overwrite it with this browser's stale copy.
      if (!loaded) return;
      const current = latest.current;
      const next = change(current);
      if (next === current) return;
      latest.current = next;
      setOptimistic(next);
      write(changedLayoutBoards(current, next), next);
    },
    [loaded, write],
  );

  // Before layouts were shared, this browser kept them to itself; upload that once so nothing is lost.
  useEffect(() => {
    if (!loaded || readStorage(UPLOADED_KEY)) return;
    writeStorage(UPLOADED_KEY, "1");
    update((current) => mergeLayouts(current, cached));
  }, [loaded, cached, update]);

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

  const rememberLists = useCallback(
    (board: string, shown: readonly string[]) => update((current) => withListsRemembered(current, board, shown)),
    [update],
  );
  const removeList = useCallback((board: string, list: string) => update((current) => withoutList(current, board, list)), [update]);

  return { layout, loaded, addBoard, addList, moveList, rememberLists, removeList };
};
