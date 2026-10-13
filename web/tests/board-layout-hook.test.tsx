import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useBoardLayout } from "@/hooks/useBoardLayout";
import { BOARD_LAYOUT_STORAGE_KEY, BOARD_LAYOUT_TAG, formatLayoutMemo } from "@/lib/board";
import { type Memo, MemoSchema, Visibility } from "@/types/proto/api/v1/memo_service_pb";

const feed = vi.hoisted(() => ({ memos: [] as unknown[], isSuccess: true, request: undefined as unknown }));
const createMemo = vi.hoisted(() => vi.fn(async (memo: { content: string }) => ({ name: "memos/new", content: memo.content })));
const updateMemo = vi.hoisted(() => vi.fn(async () => ({})));

vi.mock("@/hooks/useMemoQueries", () => ({
  memoKeys: { lists: () => ["memos", "list"] },
  useInfiniteMemos: (request: unknown) => {
    feed.request = request;
    return {
      data: { pages: [{ memos: feed.memos }] },
      isSuccess: feed.isSuccess,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
    };
  },
  useCreateMemo: () => ({ mutateAsync: createMemo }),
  useUpdateMemo: () => ({ mutateAsync: updateMemo }),
}));
vi.mock("@/hooks/useCurrentUser", () => ({ default: () => ({ name: "users/tom" }) }));

const layoutMemo = (name: string, board: string, lists: string[]): Memo =>
  create(MemoSchema, {
    name,
    tags: [BOARD_LAYOUT_TAG],
    content: formatLayoutMemo(board, lists),
    createTime: timestampFromDate(new Date("2026-10-01T00:00:00Z")),
  } as Record<string, unknown>);

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
);

beforeEach(() => {
  localStorage.clear();
  // Each browser uploads its old local layout once; most tests start after that.
  localStorage.setItem("memos-board-layout-uploaded", "1");
  feed.memos = [];
  feed.isSuccess = true;
  createMemo.mockClear();
  updateMemo.mockClear();
});

describe("useBoardLayout (shared layout memos)", () => {
  it("asks for the signed-in user's layout memos and reads the boards from them", () => {
    feed.memos = [layoutMemo("memos/9", "TWork", ["todo", "doing", "done"])];
    const { result } = renderHook(() => useBoardLayout(), { wrapper });
    expect(feed.request).toMatchObject({ filter: '(tag in ["board-layout"]) && (creator == "users/tom")' });
    expect(result.current.layout).toEqual({ boards: ["TWork"], lists: { TWork: ["todo", "doing", "done"] } });
    expect(result.current.loaded).toBe(true);
  });

  it("saves a new list into the board's existing memo", async () => {
    feed.memos = [layoutMemo("memos/9", "TWork", ["todo", "done"])];
    const { result } = renderHook(() => useBoardLayout(), { wrapper });
    act(() => result.current.addList("TWork", "review", ["todo", "done"]));

    expect(result.current.layout.lists.TWork).toEqual(["todo", "done", "review"]);
    await waitFor(() =>
      expect(updateMemo).toHaveBeenCalledWith({
        update: { name: "memos/9", content: formatLayoutMemo("TWork", ["todo", "done", "review"]) },
        updateMask: ["content"],
      }),
    );
    expect(createMemo).not.toHaveBeenCalled();
  });

  it("creates one private memo for a new board, even with quick edits", async () => {
    const { result } = renderHook(() => useBoardLayout(), { wrapper });
    act(() => result.current.addBoard("home"));
    act(() => result.current.addList("home", "chores", []));

    await waitFor(() => expect(updateMemo).toHaveBeenCalled());
    expect(createMemo).toHaveBeenCalledTimes(1);
    expect(createMemo).toHaveBeenCalledWith({ content: formatLayoutMemo("home", []), visibility: Visibility.PRIVATE });
    expect(updateMemo).toHaveBeenCalledWith({
      update: { name: "memos/new", content: formatLayoutMemo("home", ["chores"]) },
      updateMask: ["content"],
    });
  });

  it("writes nothing until the shared layout has loaded", () => {
    feed.isSuccess = false;
    localStorage.setItem(BOARD_LAYOUT_STORAGE_KEY, JSON.stringify({ boards: ["work"], lists: { work: ["todo"] } }));
    const { result } = renderHook(() => useBoardLayout(), { wrapper });
    expect(result.current.layout.lists.work).toEqual(["todo"]);
    act(() => result.current.rememberLists("work", ["todo", "doing"]));
    expect(createMemo).not.toHaveBeenCalled();
    expect(updateMemo).not.toHaveBeenCalled();
  });

  it("uploads this browser's old local layout once, keeping the shared lists", async () => {
    localStorage.removeItem("memos-board-layout-uploaded");
    localStorage.setItem(BOARD_LAYOUT_STORAGE_KEY, JSON.stringify({ boards: ["TWork"], lists: { TWork: ["todo", "review"] } }));
    feed.memos = [layoutMemo("memos/9", "TWork", ["todo", "doing"])];
    const { unmount } = renderHook(() => useBoardLayout(), { wrapper });

    await waitFor(() =>
      expect(updateMemo).toHaveBeenCalledWith({
        update: { name: "memos/9", content: formatLayoutMemo("TWork", ["todo", "doing", "review"]) },
        updateMask: ["content"],
      }),
    );
    expect(localStorage.getItem("memos-board-layout-uploaded")).toBe("1");
    unmount();

    updateMemo.mockClear();
    renderHook(() => useBoardLayout(), { wrapper });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(updateMemo).not.toHaveBeenCalled();
  });
});
