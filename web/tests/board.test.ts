import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { describe, expect, it } from "vitest";
import {
  BOARD_FILTER,
  type BoardCard,
  buildBoards,
  compareCards,
  DEFAULT_LIST,
  formatBoardSegment,
  getBoardCards,
  getCardTitle,
  getChecklistProgress,
  getDueState,
  isDoneList,
  moveCardToList,
  normalizeBoardSegment,
  orderLists,
  parseBoardLayout,
  parseBoardTag,
  planCardDrop,
  withList,
  withListMoved,
} from "@/lib/board";
import { type Memo, MemoSchema } from "@/types/proto/api/v1/memo_service_pb";

const memo = (name: string, tags: string[], extra: Partial<Memo> = {}): Memo =>
  create(MemoSchema, { name, tags, content: tags.map((t) => `#${t}`).join(" "), ...extra } as Record<string, unknown>);

const at = (iso: string) => timestampFromDate(new Date(iso));

describe("board tags", () => {
  it("parses board and list from a board tag", () => {
    expect(parseBoardTag("board/work/todo")).toEqual({ tag: "board/work/todo", board: "work", list: "todo" });
    expect(parseBoardTag("board/work")).toEqual({ tag: "board/work", board: "work", list: undefined });
    expect(parseBoardTag("board/work/in/progress")?.list).toBe("in/progress");
  });

  it("ignores tags that are not board tags", () => {
    expect(parseBoardTag("board")).toBeNull();
    expect(parseBoardTag("board/")).toBeNull();
    expect(parseBoardTag("boards/work/todo")).toBeNull();
    expect(parseBoardTag("work/board/todo")).toBeNull();
  });

  it("filters server-side by the board prefix", () => {
    expect(BOARD_FILTER).toBe('tags.exists(t, t.startsWith("board/"))');
  });

  it("normalizes typed names to a single tag segment", () => {
    expect(normalizeBoardSegment("  In Progress ")).toBe("In-Progress");
    expect(normalizeBoardSegment("a/b #c")).toBe("a-b-c");
    expect(normalizeBoardSegment("///")).toBe("");
    expect(formatBoardSegment("in-progress")).toBe("In progress");
  });
});

describe("cards", () => {
  it("puts a memo with tags on two boards on both, and once per board", () => {
    const cards = getBoardCards([memo("memos/1", ["board/work/todo", "board/home/doing", "board/work/done", "idea"])]);
    expect(cards.map((c) => [c.board, c.list])).toEqual([
      ["work", "todo"],
      ["home", "doing"],
    ]);
  });

  it("orders positioned cards by position, then unpositioned newest first", () => {
    const card = (name: string, position: number | undefined, created: string): BoardCard => ({
      memo: memo(name, ["board/w/todo"], {
        boardPositions: position === undefined ? {} : { w: position },
        createTime: at(created),
      }),
      board: "w",
      list: "todo",
      tag: "board/w/todo",
    });
    const sorted = [
      card("memos/a", undefined, "2026-01-01"),
      card("memos/b", 20, "2026-01-01"),
      card("memos/c", 10, "2026-01-01"),
      card("memos/d", undefined, "2026-02-01"),
    ].sort(compareCards);
    expect(sorted.map((c) => c.memo.name)).toEqual(["memos/c", "memos/b", "memos/d", "memos/a"]);
  });

  it("keeps a separate position per board", () => {
    const m = memo("memos/1", ["board/a/todo", "board/b/todo"], { boardPositions: { a: 5, b: 99 } });
    const boards = buildBoards([m, memo("memos/2", ["board/b/todo"], { boardPositions: { b: 1 } })]);
    const b = boards.find((x) => x.name === "b");
    expect(b?.lists[0].cards.map((c) => c.memo.name)).toEqual(["memos/2", "memos/1"]);
    const a = boards.find((x) => x.name === "a");
    expect(a?.lists[0].cards.map((c) => c.memo.name)).toEqual(["memos/1"]);
  });
});

describe("boards and lists", () => {
  it("builds boards from tags, with lists in todo -> done order", () => {
    const boards = buildBoards([
      memo("memos/1", ["board/work/done"]),
      memo("memos/2", ["board/work/todo"]),
      memo("memos/3", ["board/work/doing"]),
      memo("memos/4", ["board/home/chores"]),
    ]);
    expect(boards.map((b) => b.name)).toEqual(["home", "work"]);
    expect(boards[1].lists.map((l) => l.name)).toEqual(["todo", "doing", "done"]);
  });

  it("honours a saved list order and lists with no cards", () => {
    const layout = { boards: ["work"], lists: { work: ["done", "todo", "ideas"] } };
    const [board] = buildBoards([memo("memos/1", ["board/work/todo"])], layout);
    expect(board.lists.map((l) => l.name)).toEqual(["done", "todo", "ideas"]);
    expect(board.lists.find((l) => l.name === "ideas")?.cards).toEqual([]);
  });

  it("shows an empty remembered board", () => {
    expect(buildBoards([], { boards: ["later"], lists: {} }).map((b) => b.name)).toEqual(["later"]);
  });

  it("places a list-less card in the first list, or a default list when there are none", () => {
    const withLists = buildBoards([memo("memos/1", ["board/w"]), memo("memos/2", ["board/w/todo"]), memo("memos/3", ["board/w/done"])]);
    expect(withLists[0].lists[0].name).toBe("todo");
    expect(withLists[0].lists[0].cards.map((c) => c.memo.name).sort()).toEqual(["memos/1", "memos/2"]);

    const alone = buildBoards([memo("memos/1", ["board/w"])]);
    expect(alone[0].lists.map((l) => l.name)).toEqual([DEFAULT_LIST]);
  });

  it("orders unknown lists between the working and review lists, alphabetically", () => {
    expect(orderLists(["done", "zeta", "alpha", "todo"])).toEqual(["todo", "alpha", "zeta", "done"]);
  });

  it("recognises finished lists", () => {
    expect(isDoneList("Done")).toBe(true);
    expect(isDoneList("todo")).toBe(false);
    expect(isDoneList(undefined)).toBe(false);
  });
});

describe("planCardDrop", () => {
  const list = (positions: Array<[string, number | undefined]>): BoardCard[] =>
    positions.map(([name, position]) => ({
      memo: memo(name, ["board/w/todo"], { boardPositions: position === undefined ? {} : { w: position } }),
      board: "w",
      list: "todo",
      tag: "board/w/todo",
    }));

  it("splits the gap between two positioned neighbours and writes only the moved card", () => {
    const cards = list([
      ["memos/a", 100],
      ["memos/b", 200],
    ]);
    expect(planCardDrop({ cards, movingName: "memos/x", index: 1 })).toEqual({ "memos/x": 150 });
  });

  it("goes before the first and after the last card", () => {
    const cards = list([
      ["memos/a", 100],
      ["memos/b", 200],
    ]);
    expect(planCardDrop({ cards, movingName: "memos/x", index: 0 })["memos/x"]).toBeLessThan(100);
    expect(planCardDrop({ cards, movingName: "memos/x", index: 2 })["memos/x"]).toBeGreaterThan(200);
  });

  it("lands in an empty list", () => {
    expect(planCardDrop({ cards: [], movingName: "memos/x", index: 0 })).toEqual({ "memos/x": 1024 });
  });

  it("ignores the moving card when reordering within a list", () => {
    const cards = list([
      ["memos/a", 100],
      ["memos/b", 200],
      ["memos/c", 300],
    ]);
    // Drag a below c: neighbours become c only.
    const plan = planCardDrop({ cards, movingName: "memos/a", index: 2 });
    expect(Object.keys(plan)).toEqual(["memos/a"]);
    expect(plan["memos/a"]).toBeGreaterThan(300);
  });

  it("renumbers the whole list when a neighbour has no position", () => {
    const cards = list([
      ["memos/a", undefined],
      ["memos/b", undefined],
    ]);
    const plan = planCardDrop({ cards, movingName: "memos/x", index: 1 });
    expect(plan).toEqual({ "memos/a": 1024, "memos/x": 2048, "memos/b": 3072 });
  });

  it("renumbers when the gap between neighbours is exhausted", () => {
    const cards = list([
      ["memos/a", 1],
      ["memos/b", 1 + 1e-9],
    ]);
    const plan = planCardDrop({ cards, movingName: "memos/x", index: 1 });
    expect(Object.keys(plan).sort()).toEqual(["memos/a", "memos/b", "memos/x"]);
    expect(plan["memos/a"]).toBeLessThan(plan["memos/x"]);
    expect(plan["memos/x"]).toBeLessThan(plan["memos/b"]);
  });
});

describe("moveCardToList", () => {
  const card = { board: "work", tag: "board/work/todo" };

  it("rewrites the placing tag and nothing else", () => {
    expect(moveCardToList("Ship it #board/work/todo #idea", card, "doing")).toBe("Ship it #board/work/doing #idea");
  });

  it("leaves the same list name on another board alone", () => {
    expect(moveCardToList("#board/work/todo #board/home/todo", card, "done")).toBe("#board/work/done #board/home/todo");
  });

  it("does not touch tags in code", () => {
    const content = "`#board/work/todo` and\n```\n#board/work/todo\n```\n#board/work/todo";
    expect(moveCardToList(content, card, "done")).toBe("`#board/work/todo` and\n```\n#board/work/todo\n```\n#board/work/done");
  });

  it("gives a bare board tag its first list", () => {
    expect(moveCardToList("Task #board/work", { board: "work", tag: "board/work" }, "todo")).toBe("Task #board/work/todo");
  });

  it("does not match a longer tag that shares the prefix", () => {
    expect(moveCardToList("#board/work/todo-later", card, "done")).toBe("#board/work/todo-later");
  });
});

describe("card details", () => {
  it("titles a card from its heading or first line without board tags", () => {
    expect(getCardTitle(memo("m", [], { content: "# Plan\nbody", property: { title: "Plan" } as Memo["property"] }))).toBe("Plan");
    expect(getCardTitle(memo("m", [], { content: "Buy milk #board/home/todo #errand" }))).toBe("Buy milk #errand");
    expect(getCardTitle(memo("m", [], { content: "\n- [ ] Call Sam #board/home/todo" }))).toBe("Call Sam");
  });

  it("counts checklist progress outside code", () => {
    expect(getChecklistProgress("- [x] a\n- [ ] b\n* [X] c\ntext")).toEqual({ done: 2, total: 3 });
    expect(getChecklistProgress("```\n- [ ] not a task\n```")).toBeNull();
    expect(getChecklistProgress("no tasks")).toBeNull();
  });

  it("classifies due dates", () => {
    const now = new Date("2026-06-10T12:00:00Z");
    expect(getDueState(new Date("2026-06-09T12:00:00Z"), now, "todo")).toBe("overdue");
    expect(getDueState(new Date("2026-06-10T20:00:00Z"), now, "todo")).toBe("soon");
    expect(getDueState(new Date("2026-06-20T12:00:00Z"), now, "todo")).toBe("later");
    expect(getDueState(new Date("2026-06-01T12:00:00Z"), now, "done")).toBe("done");
  });
});

describe("saved layout", () => {
  it("ignores malformed storage", () => {
    expect(parseBoardLayout(null)).toEqual({ boards: [], lists: {} });
    expect(parseBoardLayout("{oops")).toEqual({ boards: [], lists: {} });
    expect(parseBoardLayout(JSON.stringify({ boards: ["a", 1], lists: { a: ["x", 2], b: "no" } }))).toEqual({
      boards: ["a"],
      lists: { a: ["x"] },
    });
  });

  it("adds a list, remembering the on-screen order first", () => {
    const layout = withList({ boards: [], lists: {} }, "work", "review", ["todo", "done"]);
    expect(layout).toEqual({ boards: ["work"], lists: { work: ["todo", "done", "review"] } });
    expect(withList(layout, "work", "review")).toEqual(layout);
  });

  it("moves a list one place and stops at the ends", () => {
    const base = { boards: ["w"], lists: {} };
    expect(withListMoved(base, "w", "done", -1, ["todo", "done"]).lists.w).toEqual(["done", "todo"]);
    expect(withListMoved(base, "w", "todo", -1, ["todo", "done"])).toBe(base);
    expect(withListMoved(base, "w", "done", 1, ["todo", "done"])).toBe(base);
  });
});
