import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { act, createEvent, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import BoardView, { dropIndexFromPointer } from "@/components/Board/BoardView";
import { type BoardLayout, buildBoards } from "@/lib/board";
import { type Memo, MemoSchema } from "@/types/proto/api/v1/memo_service_pb";

const update = vi.hoisted(() => vi.fn(async () => ({})));
const create_ = vi.hoisted(() => vi.fn(async () => ({})));

vi.mock("@/hooks/useMemoQueries", () => ({
  useUpdateMemo: () => ({ mutateAsync: update }),
  useCreateMemo: () => ({ mutateAsync: create_, isPending: false }),
}));
vi.mock("@/utils/i18n", () => ({ useTranslate: () => (key: string) => key }));

/** The server reports every ancestor of a hierarchical tag: `a/b/c` arrives as `a`, `a/b`, `a/b/c`. */
const withAncestors = (tag: string): string[] => tag.split("/").map((_, i, parts) => parts.slice(0, i + 1).join("/"));

const memo = (n: number, tag: string, extra: Record<string, unknown> = {}): Memo =>
  create(MemoSchema, {
    name: `memos/${n}`,
    content: `Card ${n} #${tag}`,
    tags: withAncestors(tag),
    snippet: `Card ${n}`,
    ...extra,
  } as Record<string, unknown>);

const dataTransfer = () => ({ setData: vi.fn(), effectAllowed: "", dropEffect: "" });

const renderBoard = (
  memos: Memo[],
  handlers: Partial<{
    onOpenCard: () => void;
    onAddList: (n: string) => void;
    onMoveList: () => void;
    onRemoveList: (n: string) => void;
  }> = {},
  layout?: BoardLayout,
) => {
  const board = buildBoards(memos, layout).find((b) => b.name === "work") ?? buildBoards(memos, layout)[0];
  return render(
    <BoardView
      board={board}
      onOpenCard={handlers.onOpenCard ?? vi.fn()}
      onAddList={handlers.onAddList ?? vi.fn()}
      onMoveList={handlers.onMoveList ?? vi.fn()}
      onRemoveList={handlers.onRemoveList ?? vi.fn()}
    />,
  );
};

/** jsdom has no layout: give every card a 40px box stacked in its list, in DOM order. */
const layoutCards = (list: HTMLElement) => {
  Array.from(list.querySelectorAll<HTMLElement>("[data-card]")).forEach((el, i) => {
    el.getBoundingClientRect = () => ({
      top: i * 50,
      height: 40,
      bottom: i * 50 + 40,
      left: 0,
      right: 0,
      width: 0,
      x: 0,
      y: i * 50,
      toJSON: () => ({}),
    });
  });
};

/** jsdom's drag events drop clientY, so set it explicitly. */
const dragAt = (type: "dragOver" | "drop", target: Element, clientY: number, dt: ReturnType<typeof dataTransfer>) => {
  const event = createEvent[type](target, { dataTransfer: dt });
  Object.defineProperty(event, "clientY", { value: clientY });
  fireEvent(target, event);
};

beforeEach(() => {
  update.mockClear();
  create_.mockClear();
});

describe("dropIndexFromPointer", () => {
  const rects = [
    { top: 0, height: 40 },
    { top: 50, height: 40 },
  ];
  it("lands before a card when above its midpoint and after the last when below all", () => {
    expect(dropIndexFromPointer(5, rects)).toBe(0);
    expect(dropIndexFromPointer(30, rects)).toBe(1);
    expect(dropIndexFromPointer(80, rects)).toBe(2);
    expect(dropIndexFromPointer(10, [])).toBe(0);
  });
});

describe("<BoardView>", () => {
  it("renders a column per list with its cards in order, due dates, checklists and attachments", () => {
    const due = new Date();
    due.setDate(due.getDate() - 2);
    renderBoard([
      memo(1, "board/work/todo", {
        boardPositions: { work: 1 },
        dueTime: timestampFromDate(due),
        content: "Card 1\n- [x] a\n- [ ] b #board/work/todo",
      }),
      memo(2, "board/work/todo", { boardPositions: { work: 2 } }),
      memo(3, "board/work/done"),
    ]);

    const todo = screen.getByRole("region", { name: "Todo" });
    expect(
      within(todo)
        .getAllByRole("article")
        .map((a) => a.getAttribute("aria-label")),
    ).toEqual(["Card 1", "Card 2"]);
    expect(within(screen.getByRole("region", { name: "Done" })).getAllByRole("article")).toHaveLength(1);
    expect(todo.querySelector('[data-due-state="overdue"]')).not.toBeNull();
    expect(todo.querySelector('[data-checklist="1/2"]')).not.toBeNull();
  });

  it("marks a due card in the done list as done rather than overdue", () => {
    const due = new Date();
    due.setDate(due.getDate() - 2);
    renderBoard([memo(1, "board/work/done", { dueTime: timestampFromDate(due) }), memo(2, "board/work/todo")]);
    expect(document.querySelector('[data-due-state="done"]')).not.toBeNull();
    expect(document.querySelector('[data-due-state="overdue"]')).toBeNull();
  });

  it("opens a card on click", () => {
    const onOpenCard = vi.fn();
    renderBoard([memo(1, "board/work/todo")], { onOpenCard });
    fireEvent.click(screen.getByRole("article", { name: "Card 1" }));
    expect(onOpenCard).toHaveBeenCalledWith(expect.objectContaining({ board: "work", list: "todo" }));
  });

  it("drops a card into another list: rewrites its tag and saves its position there", async () => {
    renderBoard([
      memo(1, "board/work/todo", { boardPositions: { work: 100 } }),
      memo(2, "board/work/done", { boardPositions: { work: 100 } }),
      memo(3, "board/work/done", { boardPositions: { work: 200 } }),
    ]);
    const done = document.querySelector<HTMLElement>('[data-drop-list="done"]') as HTMLElement;
    layoutCards(done);
    const dt = dataTransfer();

    fireEvent.dragStart(screen.getByRole("article", { name: "Card 1" }), { dataTransfer: dt });
    // Between Card 2 (top 0..40) and Card 3 (top 50..90).
    dragAt("dragOver", done, 45, dt);
    await act(async () => {
      dragAt("drop", done, 45, dt);
    });

    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({
      update: {
        name: "memos/1",
        content: "Card 1 #board/work/done",
        tags: ["board", "board/work", "board/work/done"],
        boardPositions: { work: 150 },
      },
      updateMask: ["content", "board_positions"],
    });
  });

  it("reordering inside a list writes only a position, leaving the tag alone", async () => {
    renderBoard([
      memo(1, "board/work/todo", { boardPositions: { work: 100 } }),
      memo(2, "board/work/todo", { boardPositions: { work: 200 } }),
    ]);
    const todo = document.querySelector<HTMLElement>('[data-drop-list="todo"]') as HTMLElement;
    layoutCards(todo);
    const dt = dataTransfer();

    fireEvent.dragStart(screen.getByRole("article", { name: "Card 1" }), { dataTransfer: dt });
    dragAt("dragOver", todo, 500, dt);
    await act(async () => {
      dragAt("drop", todo, 500, dt);
    });

    expect(update).toHaveBeenCalledTimes(1);
    const call = (update.mock.calls[0] as unknown[])[0] as { updateMask: string[]; update: { boardPositions: Record<string, number> } };
    expect(call.updateMask).toEqual(["board_positions"]);
    expect(call.update.boardPositions.work).toBeGreaterThan(200);
  });

  it("keeps the other boards' positions when moving on one board", async () => {
    renderBoard([
      memo(1, "board/work/todo", { tags: ["board/work/todo", "board/home/chores"], boardPositions: { work: 100, home: 7 } }),
      memo(2, "board/work/done", { boardPositions: { work: 100 } }),
    ]);
    const done = document.querySelector<HTMLElement>('[data-drop-list="done"]') as HTMLElement;
    layoutCards(done);
    const dt = dataTransfer();

    fireEvent.dragStart(screen.getByRole("article", { name: "Card 1" }), { dataTransfer: dt });
    dragAt("dragOver", done, 500, dt);
    await act(async () => {
      dragAt("drop", done, 500, dt);
    });

    const sent = ((update.mock.calls[0] as unknown[])[0] as { update: { boardPositions: Record<string, number> } }).update.boardPositions;
    expect(sent.home).toBe(7);
    expect(sent.work).toBeGreaterThan(100);
  });

  it("adds a card to a list with the list's board tag", async () => {
    renderBoard([memo(1, "board/work/todo")]);
    const todo = screen.getByRole("region", { name: "Todo" });

    fireEvent.click(within(todo).getByRole("button", { name: "board.add-card" }));
    fireEvent.change(within(todo).getByLabelText("board.card-placeholder"), { target: { value: "Write tests" } });
    await act(async () => {
      fireEvent.click(within(todo).getByRole("button", { name: "board.add-card" }));
    });

    expect(create_).toHaveBeenCalledWith(expect.objectContaining({ content: "Write tests #board/work/todo" }));
  });

  it("adds a list with a tag-safe name and moves lists", () => {
    const onAddList = vi.fn();
    const onMoveList = vi.fn();
    renderBoard([memo(1, "board/work/todo"), memo(2, "board/work/done")], { onAddList, onMoveList });

    fireEvent.change(screen.getByLabelText("board.list-name-placeholder"), { target: { value: "In Review/QA" } });
    fireEvent.click(screen.getByRole("button", { name: "board.add-list" }));
    expect(onAddList).toHaveBeenCalledWith("In-Review-QA");

    fireEvent.click(within(screen.getByRole("region", { name: "Done" })).getByRole("button", { name: "board.move-list-left" }));
    expect(onMoveList).toHaveBeenCalledWith("done", -1);
    expect(within(screen.getByRole("region", { name: "Todo" })).getByRole("button", { name: "board.move-list-left" })).toBeDisabled();
  });

  describe("aiming at the top or bottom of a list", () => {
    const todoWithTwo = () =>
      renderBoard([
        memo(1, "board/work/todo", { boardPositions: { work: 100 } }),
        memo(2, "board/work/todo", { boardPositions: { work: 200 } }),
      ]);

    it("drops above the first card when the pointer is over the list header", async () => {
      todoWithTwo();
      const todo = screen.getByRole("region", { name: "Todo" });
      layoutCards(todo.querySelector<HTMLElement>("[data-drop-list]") as HTMLElement);
      const dt = dataTransfer();

      fireEvent.dragStart(screen.getByRole("article", { name: "Card 2" }), { dataTransfer: dt });
      dragAt("dragOver", todo.querySelector("header") as Element, -20, dt);
      await act(async () => {
        dragAt("drop", todo.querySelector("header") as Element, -20, dt);
      });

      expect(update).toHaveBeenCalledTimes(1);
      const call = (update.mock.calls[0] as unknown[])[0] as { update: { name: string; boardPositions: Record<string, number> } };
      expect(call.update.name).toBe("memos/2");
      expect(call.update.boardPositions.work).toBeLessThan(100);
    });

    it("drops below the last card when the pointer is over the 'Add a card' button", async () => {
      todoWithTwo();
      const todo = screen.getByRole("region", { name: "Todo" });
      layoutCards(todo.querySelector<HTMLElement>("[data-drop-list]") as HTMLElement);
      const addButton = within(todo).getByRole("button", { name: "board.add-card" });
      const dt = dataTransfer();

      fireEvent.dragStart(screen.getByRole("article", { name: "Card 1" }), { dataTransfer: dt });
      dragAt("dragOver", addButton, 400, dt);
      await act(async () => {
        dragAt("drop", addButton, 400, dt);
      });

      const call = (update.mock.calls[0] as unknown[])[0] as { update: { name: string; boardPositions: Record<string, number> } };
      expect(call.update.name).toBe("memos/1");
      expect(call.update.boardPositions.work).toBeGreaterThan(200);
    });

    it("drops into an empty list from anywhere in its column", async () => {
      renderBoard(
        [memo(1, "board/work/todo", { boardPositions: { work: 100 } })],
        {},
        { boards: ["work"], lists: { work: ["todo", "done"] } },
      );
      const done = screen.getByRole("region", { name: "Done" });
      const dt = dataTransfer();

      fireEvent.dragStart(screen.getByRole("article", { name: "Card 1" }), { dataTransfer: dt });
      dragAt("dragOver", done.querySelector("header") as Element, 5, dt);
      await act(async () => {
        dragAt("drop", done.querySelector("header") as Element, 5, dt);
      });

      const call = (update.mock.calls[0] as unknown[])[0] as { update: { content: string }; updateMask: string[] };
      expect(call.update.content).toBe("Card 1 #board/work/done");
      expect(call.updateMask).toEqual(["content", "board_positions"]);
    });

    it("shows the drop line without moving any card: it is absolutely positioned in the gap", () => {
      todoWithTwo();
      const todo = screen.getByRole("region", { name: "Todo" });
      layoutCards(todo.querySelector<HTMLElement>("[data-drop-list]") as HTMLElement);
      const dt = dataTransfer();

      fireEvent.dragStart(screen.getByRole("article", { name: "Card 2" }), { dataTransfer: dt });
      dragAt("dragOver", todo.querySelector("header") as Element, -20, dt);

      const line = todo.querySelector<HTMLElement>("[data-drop-indicator]");
      expect(line).not.toBeNull();
      expect(line).toHaveClass("absolute", "pointer-events-none");
      expect(line?.parentElement).toHaveClass("relative");
    });

    it("shows the line at the bottom when aiming below the last card", () => {
      todoWithTwo();
      const todo = screen.getByRole("region", { name: "Todo" });
      layoutCards(todo.querySelector<HTMLElement>("[data-drop-list]") as HTMLElement);
      const dt = dataTransfer();

      fireEvent.dragStart(screen.getByRole("article", { name: "Card 1" }), { dataTransfer: dt });
      dragAt("dragOver", within(todo).getByRole("button", { name: "board.add-card" }), 400, dt);

      expect(todo.querySelector('[data-drop-indicator="bottom"]')).not.toBeNull();
      expect(todo.querySelectorAll("[data-drop-indicator]")).toHaveLength(1);
    });
  });

  describe("adding a card", () => {
    const openAdd = (list: string) => {
      const region = screen.getByRole("region", { name: list });
      fireEvent.click(within(region).getByRole("button", { name: "board.add-card" }));
      return region;
    };
    const submit = async (region: HTMLElement, text: string) => {
      fireEvent.change(within(region).getByLabelText("board.card-placeholder"), { target: { value: text } });
      await act(async () => {
        fireEvent.click(within(region).getAllByRole("button", { name: "board.add-card" }).at(-1) as HTMLElement);
      });
    };

    it("puts the new card in the list it was added to, with that list's tag, at the bottom", async () => {
      renderBoard([
        memo(1, "board/work/todo"),
        memo(2, "board/work/doing", { boardPositions: { work: 100 } }),
        memo(3, "board/work/doing", { boardPositions: { work: 200 } }),
      ]);
      await submit(openAdd("Doing"), "Write tests");

      expect(update).not.toHaveBeenCalled();
      const created = (create_.mock.calls[0] as unknown[])[0] as { content: string; boardPositions: Record<string, number> };
      expect(created.content).toBe("Write tests #board/work/doing");
      expect(created.boardPositions.work).toBeGreaterThan(200);
    });

    it("gives cards that have no position one first, so the new card really is last", async () => {
      renderBoard([memo(1, "board/work/todo"), memo(2, "board/work/todo")]);
      await submit(openAdd("Todo"), "Third");

      const renumbered = update.mock.calls.map(
        (call) => (call as unknown[])[0] as { update: { name: string; boardPositions: Record<string, number> } },
      );
      expect(renumbered.map((c) => c.update.name).sort()).toEqual(["memos/1", "memos/2"]);
      const positions = renumbered.map((c) => c.update.boardPositions.work);
      const created = (create_.mock.calls[0] as unknown[])[0] as { boardPositions: Record<string, number> };
      expect(created.boardPositions.work).toBeGreaterThan(Math.max(...positions));
    });

    it("starts an empty list at the first position", async () => {
      renderBoard([memo(1, "board/work/todo")], {}, { boards: ["work"], lists: { work: ["todo", "ideas"] } });
      await submit(openAdd("Ideas"), "First idea");
      expect((create_.mock.calls[0] as unknown[])[0]).toMatchObject({
        content: "First idea #board/work/ideas",
        boardPositions: { work: 1024 },
      });
    });
  });

  describe("removing an empty list", () => {
    it("offers removal only for a list with no cards", () => {
      const onRemoveList = vi.fn();
      renderBoard([memo(1, "board/work/todo")], { onRemoveList }, { boards: ["work"], lists: { work: ["todo", "ideas"] } });

      expect(
        within(screen.getByRole("region", { name: "Todo" })).queryByRole("button", { name: "board.remove-list" }),
      ).not.toBeInTheDocument();
      fireEvent.click(within(screen.getByRole("region", { name: "Ideas" })).getByRole("button", { name: "board.remove-list" }));
      expect(onRemoveList).toHaveBeenCalledWith("ideas");
    });
  });
});
