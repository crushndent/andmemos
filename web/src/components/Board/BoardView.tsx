import { ArrowLeftIcon, ArrowRightIcon, PlusIcon, XIcon } from "lucide-react";
import { type DragEvent, type FormEvent, useRef, useState } from "react";
import toast from "react-hot-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useCreateMemo, useUpdateMemo } from "@/hooks/useMemoQueries";
import {
  BOARD_TAG_ROOT,
  type Board,
  type BoardCard as BoardCardModel,
  type BoardList,
  formatBoardSegment,
  moveCardToList,
  normalizeBoardSegment,
  planCardDrop,
} from "@/lib/board";
import { handleError } from "@/lib/error";
import { cn } from "@/lib/utils";
import type { Memo } from "@/types/proto/api/v1/memo_service_pb";
import { Visibility } from "@/types/proto/api/v1/memo_service_pb";
import { useTranslate } from "@/utils/i18n";
import BoardCard from "./BoardCard";

/** Stands in for a card that does not exist yet while planning where it goes. */
const NEW_CARD = "__new_card__";

interface DragState {
  card: BoardCardModel;
  /** The list the card was dragged out of; a list-less card counts as being in the list showing it. */
  fromList: string;
}

interface DropTarget {
  list: string;
  index: number;
}

interface Props {
  board: Board;
  onOpenCard: (card: BoardCardModel) => void;
  onAddList: (name: string) => void;
  onMoveList: (list: string, direction: -1 | 1) => void;
  /** Offered only for a list with no cards. */
  onRemoveList: (list: string) => void;
}

/** Where a dragged card would land in a list body, from the pointer's height among the other cards. */
export const dropIndexFromPointer = (clientY: number, cardRects: Array<{ top: number; height: number }>): number => {
  const index = cardRects.findIndex((rect) => clientY < rect.top + rect.height / 2);
  return index === -1 ? cardRects.length : index;
};

const AddCard = ({ board, list, cards }: { board: string; list: string; cards: readonly BoardCardModel[] }) => {
  const t = useTranslate();
  const { mutateAsync: updateMemo } = useUpdateMemo();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const { mutateAsync: createMemo, isPending } = useCreateMemo();

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    const content = text.trim();
    if (!content) return;
    try {
      // A new card goes to the bottom of its list. Cards that have no position yet are given one first,
      // so "the bottom" is a real place rather than wherever unpositioned cards happen to sort.
      const positions = planCardDrop({ cards, movingName: NEW_CARD, index: cards.length });
      const { [NEW_CARD]: newPosition, ...others } = positions;
      await Promise.all(
        Object.entries(others).flatMap(([name, position]) => {
          const existing = cards.find((card) => card.memo.name === name)?.memo;
          return existing
            ? [
                updateMemo({
                  update: { name, boardPositions: { ...existing.boardPositions, [board]: position } },
                  updateMask: ["board_positions"],
                }),
              ]
            : [];
        }),
      );
      await createMemo({
        content: `${content} #${BOARD_TAG_ROOT}/${board}/${list}`,
        visibility: Visibility.PRIVATE,
        boardPositions: { [board]: newPosition },
      } as Memo);
      setText("");
      setOpen(false);
    } catch (error: unknown) {
      handleError(error, toast.error, { context: "Add card", fallbackMessage: "An error occurred" });
    }
  };

  if (!open) {
    return (
      <Button variant="ghost" size="sm" className="w-full justify-start text-muted-foreground" onClick={() => setOpen(true)}>
        <PlusIcon className="size-4" />
        {t("board.add-card")}
      </Button>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-1.5">
      <Textarea
        autoFocus
        value={text}
        rows={3}
        placeholder={t("board.card-placeholder")}
        aria-label={t("board.card-placeholder")}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            void submit();
          } else if (event.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      <div className="flex gap-1.5">
        <Button type="submit" size="sm" disabled={isPending || !text.trim()}>
          {t("board.add-card")}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          {t("common.cancel")}
        </Button>
      </div>
    </form>
  );
};

/** A Trello-style board: lists side by side, cards draggable between and within them. */
const BoardView = ({ board, onOpenCard, onAddList, onMoveList, onRemoveList }: Props) => {
  const t = useTranslate();
  const { mutateAsync: updateMemo } = useUpdateMemo();
  const [drag, setDrag] = useState<DragState | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [newList, setNewList] = useState("");
  const now = useRef(new Date()).current;

  const handleDragStart = (event: DragEvent<HTMLElement>, card: BoardCardModel, fromList: string) => {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", card.memo.name);
    setDrag({ card, fromList });
  };

  const endDrag = () => {
    setDrag(null);
    setDropTarget(null);
  };

  const handleDragOver = (event: DragEvent<HTMLElement>, list: BoardList) => {
    if (!drag) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const rects = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("[data-drop-list] [data-card]"))
      .filter((el) => el.dataset.card !== drag.card.memo.name)
      .map((el) => el.getBoundingClientRect());
    const index = dropIndexFromPointer(event.clientY, rects);
    setDropTarget((current) => (current?.list === list.name && current.index === index ? current : { list: list.name, index }));
  };

  const handleDrop = async (event: DragEvent<HTMLElement>, list: BoardList) => {
    event.preventDefault();
    const target = dropTarget;
    const moving = drag?.card;
    const fromList = drag?.fromList;
    endDrag();
    if (!moving || !target || target.list !== list.name) return;

    const positions = planCardDrop({ cards: list.cards, movingName: moving.memo.name, index: target.index });
    const changedList = fromList !== list.name;
    const byName = new Map<string, Memo>(list.cards.map((card) => [card.memo.name, card.memo]));
    byName.set(moving.memo.name, moving.memo);

    try {
      await Promise.all(
        Object.entries(positions).map(([name, position]) => {
          const memo = byName.get(name);
          if (!memo) return Promise.resolve();
          const boardPositions = { ...memo.boardPositions, [board.name]: position };
          if (name === moving.memo.name && changedList) {
            const newTag = `${BOARD_TAG_ROOT}/${board.name}/${list.name}`;
            return updateMemo({
              update: {
                name,
                content: moveCardToList(memo.content, moving, list.name),
                tags: memo.tags.map((tag) => (tag === moving.tag ? newTag : tag)),
                boardPositions,
              },
              updateMask: ["content", "board_positions"],
            });
          }
          return updateMemo({ update: { name, boardPositions }, updateMask: ["board_positions"] });
        }),
      );
    } catch (error: unknown) {
      handleError(error, toast.error, { context: "Move card", fallbackMessage: "An error occurred" });
    }
  };

  const submitNewList = (event: FormEvent) => {
    event.preventDefault();
    const name = normalizeBoardSegment(newList);
    if (!name) return;
    onAddList(name);
    setNewList("");
  };

  return (
    <div className="flex items-start gap-3 overflow-x-auto pb-4" data-testid="board">
      {board.lists.map((list, listIndex) => (
        <section
          key={list.name}
          aria-label={formatBoardSegment(list.name)}
          data-list={list.name}
          className="flex w-72 shrink-0 flex-col gap-2 rounded-lg bg-muted/60 p-2"
          // The whole column accepts a drop, not just the stack of cards: the header and the "Add a card"
          // button are where "above the first card" and "below the last card" are aimed.
          onDragOver={(event) => handleDragOver(event, list)}
          onDrop={(event) => void handleDrop(event, list)}
        >
          <header className="flex items-center justify-between gap-1 px-1">
            <h2 className="truncate text-sm font-semibold">
              {formatBoardSegment(list.name)} <span className="font-normal text-muted-foreground">{list.cards.length}</span>
            </h2>
            <div className="flex">
              {list.cards.length === 0 && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("board.remove-list")}
                  title={t("board.remove-list")}
                  onClick={() => onRemoveList(list.name)}
                >
                  <XIcon className="size-3.5" />
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={listIndex === 0}
                aria-label={t("board.move-list-left")}
                onClick={() => onMoveList(list.name, -1)}
              >
                <ArrowLeftIcon className="size-3.5 rtl:rotate-180" />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={listIndex === board.lists.length - 1}
                aria-label={t("board.move-list-right")}
                onClick={() => onMoveList(list.name, 1)}
              >
                <ArrowRightIcon className="size-3.5 rtl:rotate-180" />
              </Button>
            </div>
          </header>
          <div data-drop-list={list.name} className="relative flex min-h-8 flex-col gap-2">
            {(() => {
              // Indices skip the card being dragged: it stays in the DOM (removing it would cancel the
              // browser's drag) but is dimmed, and the drop indicator counts only the others. The
              // indicator is absolutely positioned in the gap so showing it never moves a card.
              const targeted = dropTarget?.list === list.name ? dropTarget : null;
              const visibleCount = list.cards.filter((card) => card.memo.name !== drag?.card.memo.name).length;
              let slot = 0;
              const rows = list.cards.map((card) => {
                const isDragged = card.memo.name === drag?.card.memo.name;
                const before = !isDragged && targeted?.index === slot;
                const after = !isDragged && slot === visibleCount - 1 && targeted !== null && targeted.index >= visibleCount;
                if (!isDragged) slot += 1;
                return (
                  <div key={card.memo.name} className="relative">
                    {before && <DropIndicator edge="top" />}
                    <BoardCard
                      card={card}
                      now={now}
                      dragging={isDragged}
                      onOpen={onOpenCard}
                      onDragStart={(event, dragged) => handleDragStart(event, dragged, list.name)}
                      onDragEnd={endDrag}
                    />
                    {after && <DropIndicator edge="bottom" />}
                  </div>
                );
              });
              if (targeted && visibleCount === 0) rows.push(<DropIndicator key="empty" edge="top" />);
              return rows;
            })()}
          </div>
          <AddCard board={board.name} list={list.name} cards={list.cards} />
        </section>
      ))}
      <form onSubmit={submitNewList} className="flex w-72 shrink-0 flex-col gap-1.5 rounded-lg bg-muted/30 p-2">
        <Input
          value={newList}
          aria-label={t("board.list-name-placeholder")}
          placeholder={t("board.list-name-placeholder")}
          onChange={(event) => setNewList(event.target.value)}
        />
        <Button
          type="submit"
          size="sm"
          variant="ghost"
          className={cn("justify-start", !newList.trim() && "text-muted-foreground")}
          disabled={!newList.trim()}
        >
          <PlusIcon className="size-4" />
          {t("board.add-list")}
        </Button>
      </form>
    </div>
  );
};

/** A 3px line centred in the 8px gap above or below a card; absolute, so it takes no room. */
const DropIndicator = ({ edge }: { edge: "top" | "bottom" }) => (
  <div
    role="presentation"
    data-drop-indicator={edge}
    className={cn(
      "pointer-events-none absolute inset-x-0 z-10 h-[3px] rounded-full bg-primary/70",
      edge === "top" ? "-top-[5.5px]" : "-bottom-[5.5px]",
    )}
  />
);

export default BoardView;
