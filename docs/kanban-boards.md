# Boards (kanban) — client guide

How boards work, written so another client (the Android app) can implement them and stay
interoperable with the web app. Boards are a **convention on top of tags plus two memo fields**; the
server has no board concept, so every rule below is enforced by clients.

Reference implementation: `web/src/lib/board.ts` (pure logic, unit-tested in `web/tests/board.test.ts`),
`web/src/components/Board/` (UI), `web/src/pages/Boards.tsx` (data loading). When this document and the
code disagree, the code and its tests win; please fix the document.

## 1. The model in one minute

- A memo is a **card** on a board when it has a tag `board/<board>/<list>`, e.g. `#board/work/doing`.
- `<board>` names the board, `<list>` the column (a list). Moving a card between lists means
  **rewriting that tag in the memo's text**.
- A memo may be on **several boards** (`#board/work/doing #board/home/chores`). It is one card per
  board, and each board keeps its **own position** for it.
- Order of cards inside a list is stored on the memo: `boardPositions[<board>]`, a number. Lower is
  higher up. Nobody types these; drag and drop writes them.
- A card may have a due date, `dueTime`. Every memo has these two fields; they are only meaningful
  for boards.

## 2. Tags

| Tag | Meaning |
| --- | --- |
| `board/work/todo` | Card on board `work`, list `todo` |
| `board/work` | Card on board `work`, no list yet |
| `board/work/todo/urgent` | Still list `todo` (a list is exactly one segment; anything deeper is ignored) |
| `board`, `board/` | Not a board tag |
| `boards/work/todo`, `work/board/todo` | Not board tags (the root must be exactly `board`, first) |

Rules:

- **Names are case-sensitive.** `Work` and `work` are different boards.
- **A name is one tag segment.** When the user types a name, normalize it: trim, replace `#` and `/`
  with a space, collapse whitespace to `-`, strip leading/trailing `-`. Reject it if the result is empty.
  Prefer letters, digits, `-` and `_`; the server's tag grammar is Unicode-aware but other
  punctuation can end a tag early.
- **Display names** are the segment with `-`/`_` turned into spaces and the first letter capitalized
  (`in-progress` → "In progress"). This is presentation only; always keep the raw segment for tags.

### 2.1 The server reports ancestors (the most important gotcha)

The server expands a hierarchical tag into **every ancestor**. `memo.tags` for the text
`Fix bug #board/work/doing #idea/x` is:

```json
["board", "board/work", "board/work/doing", "idea", "idea/x"]
```

So never take "the first tag starting with `board/`": that is `board/work`, which has no list, and every
card would land in the first list. (The web app shipped exactly this bug once.)

**Read tags from `memo.tags` only** (do not parse the text to find a card's list), then choose the
**placing tag** per board:

> Among the board tags of one board, the placing tag is the first one that **no other tag of that board
> extends** (no other tag starts with `<tag>/`). If somehow none qualifies, use the first.

```kotlin
fun placingTag(tags: List<BoardTag>): BoardTag =
    tags.firstOrNull { c -> tags.none { o -> o.tag.startsWith(c.tag + "/") } } ?: tags.first()
```

Do this **independently per board**, giving one card per (memo, board). Do not rely on the order of
`memo.tags`.

If a memo has two leaf tags on the same board (`#board/work/todo #board/work/doing`), it is a single
card in the first leaf. Moving it rewrites only that tag; the other remains. That is an authoring
mistake, not something to repair.

Labels (the small chips on a card) are the memo's tags that are not board tags and not the literal
`board`, and that no other tag extends, i.e. the tags the user actually wrote
(`getLabelTags` in `board.ts`).

## 3. Fields on the memo

| Field (REST JSON) | Update-mask path | Type | Notes |
| --- | --- | --- | --- |
| `dueTime` | `due_time` | RFC 3339 timestamp | Optional. Clear it by listing `due_time` in the mask with no value. |
| `boardPositions` | `board_positions` | map of board name → number (double) | Replaced **as a whole** on update. Proto field numbers: `due_time = 20`, `board_positions = 21` (`proto/api/v1/memo_service.proto`). |

Server validation (`400 INVALID_ARGUMENT` when violated): at most 64 boards in `boardPositions`; board
names non-empty and at most 128 bytes; positions finite (no NaN or infinity); `dueTime` a valid timestamp.

The values live in the memo's payload, so they survive content edits. Editing the text never clears
them. Other clients that do not know the fields leave them untouched.

## 4. API calls

All calls use the normal REST gateway with `Authorization: Bearer <token>` (a personal access token
works; see `chrome-extension/README.md` for an example client).

**Spelling matters.** Request/response **bodies use camelCase** (`boardPositions`, `dueTime`) but the
**`updateMask` query value uses the proto's snake_case** (`board_positions`, `due_time`). `updateMask=boardPositions`
is rejected with `invalid update path`.

### Load the cards

```
GET /api/v1/memos?pageSize=200&state=NORMAL&pageToken=<token>&filter=tags.exists(t, t.startsWith("board/"))
```

- URL-encode the filter. `pageSize` defaults to 50 and is capped at 1000. Follow `nextPageToken` until it is empty: a board needs every card to order and count them.
- Combine a search with `&&`, wrapping each side in parentheses: `(tags.exists(...)) && (content.contains("bug"))`.
- Drop memos that have `parent` set (those are comments).
- `state` defaults to `NORMAL`, so **archiving a memo removes it from boards** (archived memos are not listed).
- The result is whatever the signed-in user may read, including memos owned by others.

### Create a card

```
POST /api/v1/memos
{"content": "Write tests #board/work/doing",
 "visibility": "PRIVATE",
 "boardPositions": {"work": 5120},
 "dueTime": "2031-01-02T00:00:00Z"}
```

Append the tag to the text. The web app uses `PRIVATE`; pick whatever default suits the app. A text
longer than the instance limit is rejected with `400`.

### Move or reorder a card

Moving to another list rewrites the tag **and** stores the position; reordering inside a list stores
only the position:

```
PATCH /api/v1/memos/{id}?updateMask=content,board_positions
{"content": "Fix bug #board/work/done #urgent",
 "boardPositions": {"work": 2000, "home": 7}}
```

```
PATCH /api/v1/memos/{id}?updateMask=board_positions
{"boardPositions": {"work": 1536.5, "home": 7}}
```

`boardPositions` **replaces the whole map**, so always send the card's existing positions for its other
boards (`home` above) merged with the new value for this one; omitting them erases them. Read the memo
fresh before the write; there is no optimistic concurrency, so the last write wins.

### Due date

```
PATCH /api/v1/memos/{id}?updateMask=due_time        {"dueTime": "2030-05-01T09:30:00Z"}
PATCH /api/v1/memos/{id}?updateMask=due_time        {}                                  // clears it
```

Only the memo's owner (or an admin) can change a memo; others get `403`. Refresh the board when a write fails.

## 5. Lists

### 5.1 Which lists exist

A board's lists are the union of:

1. every `<list>` found on its cards, and
2. the lists the client **remembers** for that board (empty lists, and order).

Tags alone cannot hold an empty list or an order, so that **layout** is stored in memos too, shared by
every client: one memo per board, owned by the user, tagged `#board-layout`.

```
#board-layout

# TWork

- todo
- doing
- done
```

- **Reading:** load `GET /api/v1/memos?filter=tag in ["board-layout"] && creator == "users/<you>"` (follow
  `nextPageToken`). The first `# ` heading names the board; each `- `/`* `/`+ ` item is a list, in order.
  Ignore fenced code and other text; normalize names like §2 (`to do` → `to-do`) and drop duplicates.
  Two memos for one board (e.g. made offline on two devices) merge: the oldest memo's lists first, then any
  others. Write to the oldest.
- **Writing:** when a board's lists change, rewrite its memo's whole text in the format above
  (`PATCH …?updateMask=content`), or create it (`POST`, `visibility: PRIVATE`) if the board has none.
  Read it fresh first; the last write wins. Write nothing until the layout memos have loaded, or a stale
  copy overwrites the shared one.
- **Hiding:** a layout memo is data, not a note. Every memo list a client shows must leave it out; the web
  app adds `!(tag in ["board-layout"])` to every list and stats filter, and drops the tag from tag counts.
  The tag is not under `board/`, so it is never read as a card. Other Memos clients show it as an ordinary
  private memo, which is harmless.
- **Cards are not listed in it.** Card membership and order come from the cards' tags and `boardPositions`
  only; a second copy would drift.
- A device may cache the layout for offline use (the web app keeps one in `localStorage`,
  `memos-board-layout`), but the memos are the truth. Builds before shared layouts kept a layout only in the
  browser; the web app uploads it once (`memos-board-layout-uploaded` marks that).

Remember the lists a board shows (append any newly seen list to the saved order). Otherwise, when
the last card leaves a list the column disappears, because no tag mentions it any more. Offer
removal for **empty** lists only; a list that still has cards comes back from their tags.

### 5.2 Order of lists

1. The saved order first (ignoring saved names that no longer exist).
2. Then every other list by rank, then by name (`localeCompare`):

   `inbox`, `backlog`, `todo`, `to-do`, `doing`, `in-progress`, `in_progress`, **(unknown names here)**,
   `review`, `done`, `complete`, `archive`

   (case-insensitive; a name not in the table sorts just before `review`.)

### 5.3 Cards with no list

A card tagged only `board/work` (no list) is shown in the board's **first** list. If the board has
no lists at all, use a list named `inbox`. Moving such a card rewrites `#board/work` to
`#board/work/<list>`.

### 5.4 Boards

Boards are the distinct names found on cards plus those with a layout memo, sorted by name. Show the one the
user chose, else the first.

## 6. Card order

Within a list, sort cards by:

1. cards **with** a position for this board first, ascending (ties by memo name);
2. then cards **without** one, newest `createTime` first (ties by memo name).

### 6.1 Writing a position (drag and drop)

Positions are fractional so a drop normally writes **one** memo. Constants: `STEP = 1024`,
`MIN_GAP = 1e-6`. Given the target list's cards in display order, the moving card and the insertion
index among the *other* cards (0 = top, `n` = bottom):

```kotlin
fun planDrop(cards: List<Card>, moving: String, index: Int): Map<String, Double> {
    val rest = cards.filter { it.name != moving }
    val at = index.coerceIn(0, rest.size)
    val prev = rest.getOrNull(at - 1); val next = rest.getOrNull(at)
    val p = prev?.position; val n = next?.position
    val known = (prev == null || p != null) && (next == null || n != null)
    if (known) when {
        p != null && n != null -> if (n - p > MIN_GAP) return mapOf(moving to (p + n) / 2)
        p != null              -> return mapOf(moving to p + STEP)
        n != null              -> return mapOf(moving to n - STEP)
        else                   -> return mapOf(moving to STEP.toDouble())
    }
    // A neighbour has no position, or the gap is used up: number the whole list.
    val order = rest.take(at).map { it.name } + moving + rest.drop(at).map { it.name }
    return order.withIndex().associate { (i, name) -> name to (i + 1) * STEP.toDouble() }
}
```

Write each returned entry as its own `PATCH` (`board_positions`), merging into that memo's existing
map. The moved card carries the tag rewrite in the same request when it changed list.

Test vectors (positions of other cards in parentheses):

| Cards | Moving | Index | Result |
| --- | --- | --- | --- |
| a(100) b(200) | x | 1 | `x = 150` |
| a(100) b(200) | x | 0 | `x = -924` |
| a(100) b(200) | x | 2 | `x = 1124` |
| *(empty)* | x | 0 | `x = 1024` |
| a() b() *(no positions)* | x | 1 | `a=1024, x=2048, b=3072` |
| a(1) b(1.000000001) | x | 1 | renumber all three |

Reordering inside a list uses the same function: pass the list's full current cards (the function skips the
moving card itself) and the index among the *other* cards.

### 6.2 Adding a card at the bottom

A new card goes to the bottom of its list. Call `planDrop(listCards, NEW, listCards.size)`: patch any
other card it returns (this gives unpositioned cards a position first), then create the memo with the
position for `NEW`. Without this, a new card with no position would sort at the top of an unpositioned list.

### 6.3 Hit testing while dragging (UI advice)

- Make the **whole column** the drop target, not only the stack of cards. "Above the first card" and
  "below the last" are aimed at the header and the *Add a card* button.
- The insertion index is the number of other cards whose vertical midpoint is above the pointer.
- Draw the drop indicator **without changing layout** (overlay it in the gap). A line that takes space
  moves the cards under the pointer and the index flickers.

## 7. Rewriting the tag when a card changes list

Replace the card's **placing tag** in the text with `#board/<board>/<newList>`:

- Match only real tags: skip fenced code blocks (``` or ~~~) and inline code.
- Match the whole tag. After `#board/work/todo` the next character must not continue a tag
  (letters, digits, `_`, `-`, `/`, and the other characters the server's tag grammar accepts), so
  `#board/work/todo-later` is a different tag and must not be touched.
- Replace every occurrence of that tag; leave all other tags and text exactly as written.
- The card's placing tag is the one found in `memo.tags` (§2.1), which equals the text of the tag the
  user wrote. For a bare `#board/work` card the replacement is `#board/work/<newList>`.
- If the tag cannot be found in the text (grammar edge cases), do not write anything; tell the user.
- After a successful write the response's `tags` is the truth. Update the card from it.

Examples (placing tag in the first column):

| Text | Placing tag | New list | Result |
| --- | --- | --- | --- |
| `Fix #board/work/doing #urgent` | `board/work/doing` | `done` | `Fix #board/work/done #urgent` |
| `#board/work/todo #board/home/todo` | `board/work/todo` | `done` | `#board/work/done #board/home/todo` |
| `` `#board/work/todo` and #board/work/todo `` | `board/work/todo` | `done` | `` `#board/work/todo` and #board/work/done `` |
| `Task #board/work` | `board/work` | `todo` | `Task #board/work/todo` |
| `#board/work/todo-later` | `board/work/todo` | `done` | unchanged (different tag) |

## 8. What a card shows

- **Title:** the memo's `property.title` (first heading) if set; otherwise the first non-empty line with
  leading Markdown markers (`#`, `>`, `*`, `-`, `+`, `[ ]`/`[x]`) removed and board tags removed.
- **Labels:** §2.1.
- **Due badge:** from `dueTime`, relative to now, in a finished list always "done":
  - list is `done`, `complete`, `completed` or `archive` (case-insensitive) → **done**
  - `dueTime` is in the past → **overdue**
  - within the next 24 hours → **soon**
  - otherwise → **later**
- **Checklist progress:** count task items `- [ ]`, `- [x]`, `- [X]` (also `*` and `+` bullets) at line
  starts, outside code; show `done/total` only when there is at least one.
- **Attachments:** the count of `attachments`.
- Opening a card shows the full memo and its due date.

## 9. Pitfalls

1. **Ancestor tags** (§2.1): choose the placing tag; never the first `board/` tag.
2. **`updateMask` is snake_case**, bodies are camelCase (§4).
3. **`boardPositions` replaces the map**: merge with the existing value or you erase the other boards' order.
4. **Do not parse the text to find a card's list**; use `memo.tags`. Parse the text only to rewrite a tag.
5. Dropping outside the card stack must still work (§6.3).
6. A list with no cards must stay visible (§5.1) or it vanishes the moment its last card moves. Save it in the
   board's layout memo so other clients see it too.
9. **Hide `#board-layout` memos** from every list, search, calendar and tag count (§5.1).
7. Comments (memos with `parent`) and archived memos are not cards.
8. Positions are IEEE doubles: keep them as `Double`, not `Float` or `Int`.

## 10. Testing a client

The web tests are a good source of vectors: `web/tests/board.test.ts` (tags, lists, positions, tag
rewrites, layout), `web/tests/board-view.test.tsx` (drag and drop behavior), and
`server/api/v1/test/memo_board_test.go` (the API contract). Build test memos with the **ancestor-expanded**
tags shown in §2.1, as the server reports them, or tests will pass against data that does not exist.
