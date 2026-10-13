import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { describe, expect, it } from "vitest";
import {
  BOARD_FILTER,
  BOARD_LAYOUT_TAG,
  type BoardCard,
  buildBoards,
  changedLayoutBoards,
  compareCards,
  DEFAULT_LIST,
  formatBoardSegment,
  formatLayoutMemo,
  getBoardCards,
  getCardTitle,
  getChecklistProgress,
  getDueState,
  getLabelTags,
  getLayoutMemos,
  HIDE_BOARD_LAYOUT_FILTER,
  isBoardLayoutMemo,
  isDoneList,
  layoutFromMemos,
  mergeLayouts,
  moveCardToList,
  normalizeBoardSegment,
  orderLists,
  parseBoardLayout,
  parseBoardTag,
  parseLayoutMemo,
  planCardDrop,
  withList,
  withListMoved,
  withListsRemembered,
  withoutList,
} from "@/lib/board";
import { type Memo, MemoSchema } from "@/types/proto/api/v1/memo_service_pb";

/** The server reports every ancestor of a hierarchical tag: `a/b/c` arrives as `a`, `a/b`, `a/b/c`. */
const withAncestors = (tags: string[]): string[] => [
  ...new Set(tags.flatMap((tag) => tag.split("/").map((_, i, parts) => parts.slice(0, i + 1).join("/")))),
];

const memo = (name: string, tags: string[], extra: Partial<Memo> = {}): Memo =>
  create(MemoSchema, { name, tags: withAncestors(tags), content: tags.map((t) => `#${t}`).join(" "), ...extra } as Record<string, unknown>);

const at = (iso: string) => timestampFromDate(new Date(iso));

describe("board tags", () => {
  it("parses board and list from a board tag", () => {
    expect(parseBoardTag("board/work/todo")).toEqual({ tag: "board/work/todo", board: "work", list: "todo" });
    expect(parseBoardTag("board/work")).toEqual({ tag: "board/work", board: "work", list: undefined });
    // A list is one segment; anything deeper still belongs to it.
    expect(parseBoardTag("board/work/todo/urgent")).toEqual({ tag: "board/work/todo/urgent", board: "work", list: "todo" });
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

describe("cards from the tags the server really reports", () => {
  it("places a card by the tag it was written with, not by the ancestors the server adds", () => {
    const m = memo("memos/1", ["board/work/doing"]);
    expect(m.tags).toEqual(["board", "board/work", "board/work/doing"]);
    const [card] = getBoardCards([m]);
    expect(card).toMatchObject({ board: "work", list: "doing", tag: "board/work/doing" });
  });

  it("puts each card in its own list rather than the first one", () => {
    const [board] = buildBoards([
      memo("memos/1", ["board/work/todo"]),
      memo("memos/2", ["board/work/doing"]),
      memo("memos/3", ["board/work/done"]),
    ]);
    expect(board.lists.map((l) => [l.name, l.cards.map((c) => c.memo.name)])).toEqual([
      ["todo", ["memos/1"]],
      ["doing", ["memos/2"]],
      ["done", ["memos/3"]],
    ]);
  });

  it("still treats a bare board tag as list-less", () => {
    const [card] = getBoardCards([memo("memos/1", ["board/work"])]);
    expect(card).toMatchObject({ board: "work", list: undefined, tag: "board/work" });
  });

  it("uses the written tag even when it has sub-parts, and keeps the card in that list", () => {
    const [card] = getBoardCards([memo("memos/1", ["board/work/todo/urgent"])]);
    expect(card).toMatchObject({ list: "todo", tag: "board/work/todo/urgent" });
  });

  it("keeps a memo on two boards in the right list of each", () => {
    const cards = getBoardCards([memo("memos/1", ["board/work/doing", "board/home/chores"])]);
    expect(cards.map((c) => [c.board, c.list, c.tag])).toEqual([
      ["work", "doing", "board/work/doing"],
      ["home", "chores", "board/home/chores"],
    ]);
  });

  it("moves a card by rewriting the tag it was written with", () => {
    const [card] = getBoardCards([memo("memos/1", ["board/work/doing"], { content: "Fix bug #board/work/doing #urgent" })]);
    expect(moveCardToList("Fix bug #board/work/doing #urgent", card, "done")).toBe("Fix bug #board/work/done #urgent");
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

describe("remembering lists", () => {
  it("adds newly seen lists after the known ones, and does nothing when nothing is new", () => {
    const layout = { boards: [], lists: { work: ["todo"] } };
    expect(withListsRemembered(layout, "work", ["todo", "doing"])).toEqual({ boards: ["work"], lists: { work: ["todo", "doing"] } });
    expect(withListsRemembered(layout, "work", ["todo"])).toBe(layout);
  });

  it("keeps a list on screen after its last card has moved away", () => {
    const remembered = withListsRemembered({ boards: [], lists: {} }, "work", ["todo", "doing"]);
    const [board] = buildBoards([memo("memos/1", ["board/work/doing"])], remembered);
    expect(board.lists.map((l) => [l.name, l.cards.length])).toEqual([
      ["todo", 0],
      ["doing", 1],
    ]);
  });

  it("forgets a list on request", () => {
    const layout = { boards: ["work"], lists: { work: ["todo", "doing"] } };
    expect(withoutList(layout, "work", "todo").lists.work).toEqual(["doing"]);
    expect(withoutList(layout, "work", "nope")).toBe(layout);
  });

  it("a forgotten list returns if a card is still tagged into it", () => {
    const [board] = buildBoards(
      [memo("memos/1", ["board/work/todo"])],
      withoutList({ boards: ["work"], lists: { work: ["todo"] } }, "work", "todo"),
    );
    expect(board.lists.map((l) => l.name)).toEqual(["todo"]);
  });
});

describe("getLabelTags", () => {
  it("shows the tags the user wrote, not board tags or the ancestors the server adds", () => {
    const m = memo("memos/1", ["board/work/doing", "idea/x", "urgent"]);
    expect(m.tags).toEqual(["board", "board/work", "board/work/doing", "idea", "idea/x", "urgent"]);
    expect(getLabelTags(m.tags)).toEqual(["idea/x", "urgent"]);
  });

  it("shows nothing for a card with only board tags", () => {
    expect(getLabelTags(memo("memos/1", ["board/work/todo"]).tags)).toEqual([]);
  });
});

describe("shared layout memos", () => {
  const layoutMemo = (name: string, content: string, created: string) =>
    create(MemoSchema, { name, tags: [BOARD_LAYOUT_TAG], content, createTime: at(created) } as Record<string, unknown>);

  it("round-trips a board's lists in order, empty ones included", () => {
    const text = formatLayoutMemo("TWork", ["todo", "doing", "done"]);
    expect(text).toBe("#board-layout\n\n# TWork\n\n- todo\n- doing\n- done\n");
    expect(parseLayoutMemo(text)).toEqual({ board: "TWork", lists: ["todo", "doing", "done"] });
    expect(parseLayoutMemo(formatLayoutMemo("home", []))).toEqual({ board: "home", lists: [] });
  });

  it("reads hand-edited text: other bullets, duplicates, code blocks and missing headings", () => {
    expect(parseLayoutMemo("#board-layout\n# Work\n* to do\n- [x] done\n- done\n```\n- nope\n```\n")).toEqual({
      board: "Work",
      lists: ["to-do", "done"],
    });
    expect(parseLayoutMemo("#board-layout\n- todo")).toBeNull();
  });

  it("builds the shared layout; a board with two memos merges them, the oldest first", () => {
    const memos = [
      layoutMemo("memos/2", formatLayoutMemo("work", ["review", "todo"]), "2026-10-02T00:00:00Z"),
      layoutMemo("memos/1", formatLayoutMemo("work", ["todo", "doing"]), "2026-10-01T00:00:00Z"),
      layoutMemo("memos/3", formatLayoutMemo("home", []), "2026-10-03T00:00:00Z"),
    ];
    expect(layoutFromMemos(memos)).toEqual({ boards: ["work", "home"], lists: { work: ["todo", "doing", "review"], home: [] } });
    expect(getLayoutMemos(memos).get("work")?.name).toBe("memos/1");
  });

  it("an empty list from the layout memo shows on the board", () => {
    const layout = layoutFromMemos([layoutMemo("memos/9", formatLayoutMemo("TWork", ["todo", "doing", "done"]), "2026-10-01T00:00:00Z")]);
    const [board] = buildBoards([memo("memos/1", ["board/TWork/doing"])], layout);
    expect(board.lists.map((l) => [l.name, l.cards.length])).toEqual([
      ["todo", 0],
      ["doing", 1],
      ["done", 0],
    ]);
  });

  it("is never a card and is hidden from memo lists", () => {
    const m = layoutMemo("memos/9", formatLayoutMemo("work", ["todo"]), "2026-10-01T00:00:00Z");
    expect(isBoardLayoutMemo(m)).toBe(true);
    expect(getBoardCards([m])).toEqual([]);
    expect(HIDE_BOARD_LAYOUT_FILTER).toBe('!(tag in ["board-layout"])');
  });

  it("finds which boards need their memo written", () => {
    const before = { boards: ["work"], lists: { work: ["todo", "done"] } };
    expect(changedLayoutBoards(before, before)).toEqual([]);
    expect(changedLayoutBoards(before, { boards: ["work"], lists: { work: ["done", "todo"] } })).toEqual(["work"]);
    expect(changedLayoutBoards(before, { boards: ["work", "home"], lists: before.lists })).toEqual(["home"]);
  });

  it("uploads a browser's old local layout without dropping shared lists", () => {
    const shared = { boards: ["work"], lists: { work: ["todo", "doing"] } };
    const local = { boards: ["work", "home"], lists: { work: ["todo", "review"], home: ["chores"] } };
    expect(mergeLayouts(shared, local)).toEqual({
      boards: ["work", "home"],
      lists: { work: ["todo", "doing", "review"], home: ["chores"] },
    });
  });
});
