import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Boards from "@/pages/Boards";
import { type Memo, MemoSchema } from "@/types/proto/api/v1/memo_service_pb";

const feed = vi.hoisted(() => ({
  memos: [] as unknown[],
  hasNextPage: false,
  isLoading: false,
  fetchNextPage: vi.fn(async () => undefined),
  request: undefined as unknown,
}));
const update = vi.hoisted(() => vi.fn(async () => ({})));

vi.mock("@/hooks/useMemoQueries", () => ({
  useInfiniteMemos: (request: unknown) => {
    feed.request = request;
    return {
      data: { pages: [{ memos: feed.memos }] },
      hasNextPage: feed.hasNextPage,
      isFetchingNextPage: false,
      fetchNextPage: feed.fetchNextPage,
      isLoading: feed.isLoading,
    };
  },
  useUpdateMemo: () => ({ mutateAsync: update }),
  useCreateMemo: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/utils/i18n", () => ({ useTranslate: () => (key: string) => key }));
vi.mock("@/components/MemoView", () => ({ default: ({ memo }: { memo: Memo }) => <div data-testid="memo-view">{memo.name}</div> }));

const memo = (n: number, tag: string, extra: Record<string, unknown> = {}): Memo =>
  create(MemoSchema, { name: `memos/${n}`, content: `Card ${n} #${tag}`, tags: [tag], snippet: `Card ${n}`, ...extra } as Record<
    string,
    unknown
  >);

const Where = () => <output data-testid="where">{useLocation().pathname}</output>;

const renderPage = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Where />
      <Routes>
        <Route path="/boards/:board?" element={<Boards />} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  localStorage.clear();
  feed.memos = [];
  feed.hasNextPage = false;
  feed.isLoading = false;
  feed.fetchNextPage.mockClear();
  update.mockClear();
});

describe("<Boards>", () => {
  it("asks only for memos that are on a board", () => {
    renderPage("/boards");
    expect(feed.request).toMatchObject({ filter: 'tags.exists(t, t.startsWith("board/"))' });
  });

  it("shows a hint when there are no boards", () => {
    renderPage("/boards");
    expect(screen.getByText("board.empty-hint")).toBeInTheDocument();
  });

  it("lists every board, shows the one in the URL, and falls back to the first", () => {
    feed.memos = [memo(1, "board/work/todo"), memo(2, "board/home/chores")];
    const { unmount } = renderPage("/boards/work");
    expect(screen.getByRole("link", { name: "Work" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("region", { name: "Todo" })).toBeInTheDocument();
    unmount();

    renderPage("/boards/nope");
    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("region", { name: "Chores" })).toBeInTheDocument();
  });

  it("ignores comments", () => {
    feed.memos = [memo(1, "board/work/todo"), memo(2, "board/work/todo", { parent: "memos/1" })];
    renderPage("/boards/work");
    expect(screen.getAllByRole("article")).toHaveLength(1);
  });

  it("keeps loading pages until the feed is exhausted", () => {
    feed.hasNextPage = true;
    renderPage("/boards");
    expect(feed.fetchNextPage).toHaveBeenCalled();
  });

  it("creates a board, remembers it, and navigates to it", () => {
    renderPage("/boards");
    fireEvent.change(screen.getByLabelText("board.new-board-placeholder"), { target: { value: "Side Project" } });
    fireEvent.click(screen.getByRole("button", { name: "board.new-board" }));

    expect(screen.getByTestId("where")).toHaveTextContent("/boards/Side-Project");
    expect(JSON.parse(localStorage.getItem("memos-board-layout") ?? "{}").boards).toEqual(["Side-Project"]);
  });

  it("adds an empty list and remembers it with the on-screen order", () => {
    feed.memos = [memo(1, "board/work/done"), memo(2, "board/work/todo")];
    renderPage("/boards/work");
    fireEvent.change(screen.getByLabelText("board.list-name-placeholder"), { target: { value: "review" } });
    fireEvent.click(screen.getByRole("button", { name: "board.add-list" }));

    expect(screen.getByRole("region", { name: "Review" })).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem("memos-board-layout") ?? "{}").lists.work).toEqual(["todo", "done", "review"]);
  });

  it("moves a list and keeps the new order", () => {
    feed.memos = [memo(1, "board/work/done"), memo(2, "board/work/todo")];
    renderPage("/boards/work");
    fireEvent.click(screen.getAllByRole("button", { name: "board.move-list-right" })[0]);

    expect(screen.getAllByRole("region").map((r) => r.getAttribute("data-list"))).toEqual(["done", "todo"]);
  });

  it("opens a card, shows its due date, and saves a new one", async () => {
    const due = new Date(2030, 0, 15, 9, 30);
    feed.memos = [memo(1, "board/work/todo", { dueTime: timestampFromDate(due) })];
    renderPage("/boards/work");

    fireEvent.click(screen.getByRole("article", { name: "Card 1" }));
    const input = await screen.findByLabelText("board.due-date");
    expect(input).toHaveValue("2030-01-15T09:30");
    expect(screen.getByTestId("memo-view")).toHaveTextContent("memos/1");

    fireEvent.change(input, { target: { value: "2030-02-01T08:00" } });
    await act(async () => {
      fireEvent.blur(input);
    });
    expect(update).toHaveBeenCalledWith({
      update: { name: "memos/1", dueTime: timestampFromDate(new Date(2030, 1, 1, 8, 0)) },
      updateMask: ["due_time"],
    });
  });

  it("clears a due date", async () => {
    feed.memos = [memo(1, "board/work/todo", { dueTime: timestampFromDate(new Date(2030, 0, 15)) })];
    renderPage("/boards/work");

    fireEvent.click(screen.getByRole("article", { name: "Card 1" }));
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "board.clear-due-date" }));
    });
    expect(update).toHaveBeenCalledWith({ update: { name: "memos/1", dueTime: undefined }, updateMask: ["due_time"] });
  });
});
