import { timestampDate } from "@bufbuild/protobuf/wkt";
import type { Memo } from "@/types/proto/api/v1/memo_service_pb";
import { findTagMatches } from "@/utils/tag-grammar";

/**
 * Boards are driven by tags: `#board/<board>/<list>` puts a memo on `<board>` in list `<list>`.
 * A memo may carry several board tags and then appears on each board; its order on every board
 * is kept separately in `memo.boardPositions[<board>]`.
 */
export const BOARD_TAG_ROOT = "board";

/** CEL filter selecting every memo that is on some board. */
export const BOARD_FILTER = `tags.exists(t, t.startsWith("${BOARD_TAG_ROOT}/"))`;

/** Gap between renumbered positions, leaving room for many midpoint inserts. */
const POSITION_STEP = 1024;
/** Midpoints closer than this are treated as exhausted and trigger a renumber. */
const MIN_POSITION_GAP = 1e-6;

export interface BoardTag {
  /** The full tag, without `#`, e.g. `board/work/todo`. */
  tag: string;
  board: string;
  /** Undefined for a bare `#board/<board>` tag. */
  list?: string;
}

export interface BoardCard {
  memo: Memo;
  board: string;
  /** The list the card is in; undefined while the card has only a bare `#board/<board>` tag. */
  list?: string;
  /** The tag that places the card, rewritten when the card moves list. */
  tag: string;
}

export interface BoardList {
  name: string;
  cards: BoardCard[];
}

export interface Board {
  name: string;
  lists: BoardList[];
}

/** Locally remembered board structure: boards and lists that exist before any card uses them, plus list order. */
export interface BoardLayout {
  boards: string[];
  lists: Record<string, string[]>;
}

export const EMPTY_BOARD_LAYOUT: BoardLayout = { boards: [], lists: {} };

/** Name of the list that holds cards with no list tag when a board has no lists yet. */
export const DEFAULT_LIST = "inbox";

/**
 * Parses `board/<board>[/<list>]`; returns null for anything that is not a board tag. A list is one
 * segment: anything written deeper (`board/work/todo/urgent`) still belongs to the `todo` list.
 */
export const parseBoardTag = (tag: string): BoardTag | null => {
  const segments = tag.split("/");
  if (segments[0] !== BOARD_TAG_ROOT || segments.length < 2 || segments[1] === "") return null;
  return { tag, board: segments[1], list: segments[2] || undefined };
};

export const getBoardTags = (tags: readonly string[]): BoardTag[] =>
  tags.map(parseBoardTag).filter((boardTag): boardTag is BoardTag => boardTag !== null);

/** Tags shown as labels on a card: the tags written on the memo, without board tags or the ancestors the server adds. */
export const getLabelTags = (tags: readonly string[]): string[] =>
  tags.filter((tag) => parseBoardTag(tag) === null && tag !== BOARD_TAG_ROOT && !tags.some((other) => other.startsWith(`${tag}/`)));

/** Makes a user-typed board or list name safe to use as a single tag segment. */
export const normalizeBoardSegment = (name: string): string =>
  name
    .trim()
    .replace(/[#/]/g, " ")
    .replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "");

/** `in-progress` -> `In progress`. */
export const formatBoardSegment = (segment: string): string => {
  const spaced = segment.replace(/[-_]+/g, " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
};

const WELL_KNOWN_LIST_ORDER = [
  "inbox",
  "backlog",
  "todo",
  "to-do",
  "doing",
  "in-progress",
  "in_progress",
  "review",
  "done",
  "complete",
  "archive",
];
const UNKNOWN_LIST_RANK = WELL_KNOWN_LIST_ORDER.indexOf("review");

const listRank = (name: string): number => {
  const index = WELL_KNOWN_LIST_ORDER.indexOf(name.toLowerCase());
  return index === -1 ? UNKNOWN_LIST_RANK - 0.5 : index;
};

/** Saved order first; any other list follows in the conventional todo -> done order, then by name. */
export const orderLists = (names: string[], saved: readonly string[] = []): string[] => {
  const present = new Set(names);
  const result = saved.filter((name) => present.has(name));
  const placed = new Set(result);
  const rest = names.filter((name) => !placed.has(name)).sort((a, b) => listRank(a) - listRank(b) || a.localeCompare(b));
  return [...result, ...rest];
};

/** Lists of a board that count as finished work, so their due dates are not flagged. */
export const isDoneList = (list: string | undefined): boolean => {
  const name = (list ?? "").toLowerCase();
  return name === "done" || name === "complete" || name === "completed" || name === "archive";
};

export const getCardPosition = (card: BoardCard): number | undefined => {
  const position = card.memo.boardPositions?.[card.board];
  return position === undefined || Number.isNaN(position) ? undefined : position;
};

const createSeconds = (memo: Memo): number => (memo.createTime ? timestampDate(memo.createTime).getTime() : 0);

/** Positioned cards first in position order; the rest follow newest first. */
export const compareCards = (a: BoardCard, b: BoardCard): number => {
  const aPos = getCardPosition(a);
  const bPos = getCardPosition(b);
  if (aPos !== undefined && bPos !== undefined) return aPos - bPos || a.memo.name.localeCompare(b.memo.name);
  if (aPos !== undefined) return -1;
  if (bPos !== undefined) return 1;
  return createSeconds(b.memo) - createSeconds(a.memo) || a.memo.name.localeCompare(b.memo.name);
};

/**
 * The tag that actually places a memo on a board. The server reports a hierarchical tag together with
 * every ancestor (`#board/work/doing` arrives as `board`, `board/work`, `board/work/doing`), so the
 * ancestors must not win: the placing tag is the first one that no other tag of the board extends.
 */
const placingTag = (tags: readonly BoardTag[]): BoardTag =>
  tags.find((candidate) => !tags.some((other) => other.tag.startsWith(`${candidate.tag}/`))) ?? tags[0];

/** One card per (memo, board). A memo tagged into several lists of one board sits in the first of them. */
export const getBoardCards = (memos: readonly Memo[]): BoardCard[] => {
  const cards: BoardCard[] = [];
  for (const memo of memos) {
    const byBoard = new Map<string, BoardTag[]>();
    for (const boardTag of getBoardTags(memo.tags)) {
      byBoard.set(boardTag.board, [...(byBoard.get(boardTag.board) ?? []), boardTag]);
    }
    for (const [board, tags] of byBoard) {
      const { tag, list } = placingTag(tags);
      cards.push({ memo, board, list, tag });
    }
  }
  return cards;
};

/** Boards with their lists and ordered cards, from memos plus the locally remembered layout. */
export const buildBoards = (memos: readonly Memo[], layout: BoardLayout = EMPTY_BOARD_LAYOUT): Board[] => {
  const cards = getBoardCards(memos);
  const names = new Set<string>(layout.boards);
  for (const card of cards) names.add(card.board);

  return [...names]
    .sort((a, b) => a.localeCompare(b))
    .map((boardName) => {
      const boardCards = cards.filter((card) => card.board === boardName);
      const listNames = new Set<string>(layout.lists[boardName] ?? []);
      for (const card of boardCards) if (card.list) listNames.add(card.list);
      const ordered = orderLists([...listNames], layout.lists[boardName]);
      // Cards with no list tag wait in the first list, or in a default one when the board has none.
      const fallback = ordered[0] ?? DEFAULT_LIST;
      const listOrder = ordered.length > 0 ? ordered : boardCards.some((card) => !card.list) ? [DEFAULT_LIST] : [];
      return {
        name: boardName,
        lists: listOrder.map((name) => ({
          name,
          cards: boardCards.filter((card) => (card.list ?? fallback) === name).sort(compareCards),
        })),
      };
    });
};

export interface DropPlanInput {
  /** The target list's cards in their current display order (may include the moving card). */
  cards: readonly BoardCard[];
  movingName: string;
  /** Where the card lands among the other cards: 0 is the top, `cards.length` (without the mover) the bottom. */
  index: number;
}

/**
 * Positions to write for a drop: just the moved card when both neighbours have positions to
 * split, otherwise the whole list is renumbered so the visible order becomes explicit.
 * Returns memo name -> new position.
 */
export const planCardDrop = ({ cards, movingName, index }: DropPlanInput): Record<string, number> => {
  const rest = cards.filter((card) => card.memo.name !== movingName);
  const at = Math.max(0, Math.min(index, rest.length));
  const previous = rest[at - 1];
  const next = rest[at];
  const previousPosition = previous ? getCardPosition(previous) : undefined;
  const nextPosition = next ? getCardPosition(next) : undefined;
  const neighboursKnown = (!previous || previousPosition !== undefined) && (!next || nextPosition !== undefined);

  if (neighboursKnown) {
    if (previousPosition !== undefined && nextPosition !== undefined) {
      const middle = (previousPosition + nextPosition) / 2;
      if (nextPosition - previousPosition > MIN_POSITION_GAP) return { [movingName]: middle };
    } else if (previousPosition !== undefined) {
      return { [movingName]: previousPosition + POSITION_STEP };
    } else if (nextPosition !== undefined) {
      return { [movingName]: nextPosition - POSITION_STEP };
    } else {
      return { [movingName]: POSITION_STEP };
    }
  }

  const ordered = [...rest.slice(0, at).map((card) => card.memo.name), movingName, ...rest.slice(at).map((card) => card.memo.name)];
  return Object.fromEntries(ordered.map((name, i) => [name, (i + 1) * POSITION_STEP]));
};

/** Blanks out fenced and inline code so tags inside code are not mistaken for real tags. */
const maskCode = (content: string): string =>
  content
    .replace(/(^|\n)(```|~~~)[\s\S]*?(\n\2[^\n]*|$)/g, (match) => match.replace(/[^\n]/g, " "))
    .replace(/`[^`\n]*`/g, (match) => " ".repeat(match.length));

/**
 * Rewrites a card's placing tag so it sits in `toList`. Only real tags are touched: tags inside
 * code are skipped, and other tags on the memo are left exactly as written.
 */
export const moveCardToList = (content: string, card: Pick<BoardCard, "board" | "tag">, toList: string): string => {
  const replacement = `#${BOARD_TAG_ROOT}/${card.board}/${toList}`;
  const matches = findTagMatches(maskCode(content)).filter((match) => match.value === card.tag);
  let result = content;
  for (const match of matches.reverse()) {
    result = result.slice(0, match.from) + replacement + result.slice(match.to);
  }
  return result;
};

/** The memo's text as a card title: the title heading, else the first line, without board tags. */
export const getCardTitle = (memo: Memo): string => {
  const stripBoardTags = (text: string) =>
    findTagMatches(text)
      .filter((match) => match.value.startsWith(`${BOARD_TAG_ROOT}/`))
      .reverse()
      .reduce((acc, match) => acc.slice(0, match.from) + acc.slice(match.to), text)
      .replace(/\s+/g, " ")
      .trim();
  const heading = memo.property?.title?.trim();
  if (heading) return heading;
  for (const line of memo.content.split("\n")) {
    const cleaned = stripBoardTags(line.replace(/^[#>*\-+\s]+(\[[ xX]\]\s*)?/, ""));
    if (cleaned) return cleaned;
  }
  return "";
};

export interface ChecklistProgress {
  done: number;
  total: number;
}

/** Task-list progress (`- [x]` of `- [ ]` items) outside code, or null when the memo has none. */
export const getChecklistProgress = (content: string): ChecklistProgress | null => {
  const items = maskCode(content).match(/^[ \t]*[-*+][ \t]+\[[ xX]\]/gm);
  if (!items) return null;
  return { total: items.length, done: items.filter((item) => /\[[xX]\]/.test(item)).length };
};

export type DueState = "overdue" | "soon" | "later" | "done";

const SOON_MS = 24 * 60 * 60 * 1000;

/** How urgent a due date is; cards in a finished list are always "done". */
export const getDueState = (due: Date, now: Date, list?: string): DueState => {
  if (isDoneList(list)) return "done";
  const remaining = due.getTime() - now.getTime();
  if (remaining < 0) return "overdue";
  return remaining <= SOON_MS ? "soon" : "later";
};

export const BOARD_LAYOUT_STORAGE_KEY = "memos-board-layout";

/** Reads the saved layout, ignoring anything malformed. */
export const parseBoardLayout = (raw: string | null): BoardLayout => {
  if (!raw) return EMPTY_BOARD_LAYOUT;
  try {
    const data = JSON.parse(raw) as Partial<BoardLayout>;
    const boards = Array.isArray(data.boards) ? data.boards.filter((b): b is string => typeof b === "string") : [];
    const lists: Record<string, string[]> = {};
    if (data.lists && typeof data.lists === "object") {
      for (const [board, names] of Object.entries(data.lists)) {
        if (Array.isArray(names)) lists[board] = names.filter((n): n is string => typeof n === "string");
      }
    }
    return { boards, lists };
  } catch {
    return EMPTY_BOARD_LAYOUT;
  }
};

/** Returns a layout with `list` added to `board` (and the board remembered). */
export const withList = (layout: BoardLayout, board: string, list: string, currentOrder: readonly string[] = []): BoardLayout => {
  const existing = layout.lists[board] ?? [...currentOrder];
  return {
    boards: layout.boards.includes(board) ? layout.boards : [...layout.boards, board],
    lists: { ...layout.lists, [board]: existing.includes(list) ? existing : [...existing, list] },
  };
};

/** Remembers the lists a board currently shows, so one that has just been emptied does not vanish. */
export const withListsRemembered = (layout: BoardLayout, board: string, shown: readonly string[]): BoardLayout => {
  const known = layout.lists[board] ?? [];
  const missing = shown.filter((list) => !known.includes(list));
  if (missing.length === 0) return layout;
  return {
    boards: layout.boards.includes(board) ? layout.boards : [...layout.boards, board],
    lists: { ...layout.lists, [board]: [...known, ...missing] },
  };
};

/** Forgets a list. Only a list with no cards disappears; one that still has cards comes back from their tags. */
export const withoutList = (layout: BoardLayout, board: string, list: string): BoardLayout => {
  const known = layout.lists[board];
  if (!known?.includes(list)) return layout;
  return { ...layout, lists: { ...layout.lists, [board]: known.filter((name) => name !== list) } };
};

export const withBoard = (layout: BoardLayout, board: string): BoardLayout =>
  layout.boards.includes(board) ? layout : { ...layout, boards: [...layout.boards, board] };

/** Moves a list one place left or right; `currentOrder` is the order on screen, saved from here on. */
export const withListMoved = (
  layout: BoardLayout,
  board: string,
  list: string,
  direction: -1 | 1,
  currentOrder: readonly string[],
): BoardLayout => {
  const order = [...currentOrder];
  const from = order.indexOf(list);
  const to = from + direction;
  if (from === -1 || to < 0 || to >= order.length) return layout;
  [order[from], order[to]] = [order[to], order[from]];
  return { ...layout, lists: { ...layout.lists, [board]: order } };
};
