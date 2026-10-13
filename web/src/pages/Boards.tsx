import { LayoutDashboardIcon, PlusIcon } from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import BoardCardDialog from "@/components/Board/BoardCardDialog";
import BoardView from "@/components/Board/BoardView";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useBoardLayout } from "@/hooks/useBoardLayout";
import { useMemoFilters } from "@/hooks/useMemoFilters";
import { useInfiniteMemos } from "@/hooks/useMemoQueries";
import { BOARD_FILTER, type BoardCard, buildBoards, formatBoardSegment, normalizeBoardSegment } from "@/lib/board";
import { combineCELFilters } from "@/lib/cel-filter";
import { cn } from "@/lib/utils";
import { ROUTES } from "@/router/routes";
import { useTranslate } from "@/utils/i18n";

const BOARD_PAGE_SIZE = 200;

/** Boards built from `#board/<board>/<list>` tags: every list is a column, every tagged memo a card. */
const Boards = () => {
  const t = useTranslate();
  const navigate = useNavigate();
  const { board: boardParam } = useParams();
  const { layout, loaded: layoutLoaded, addBoard, addList, moveList, rememberLists, removeList } = useBoardLayout();
  const [openCard, setOpenCard] = useState<BoardCard | null>(null);
  const [newBoard, setNewBoard] = useState("");

  // Search and filters narrow the cards on the board just as they narrow a memo list.
  const memoFilter = useMemoFilters({ includeMemoViews: true, includePinned: true });
  const { data, hasNextPage, isFetchingNextPage, fetchNextPage, isLoading } = useInfiniteMemos({
    filter: combineCELFilters(BOARD_FILTER, memoFilter),
    pageSize: BOARD_PAGE_SIZE,
    orderBy: "create_time desc",
  });

  // A board needs every card to order and count them, so keep loading until the feed is exhausted.
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const memos = useMemo(() => (data?.pages.flatMap((page) => page.memos) ?? []).filter((memo) => !memo.parent), [data]);
  const boards = useMemo(() => buildBoards(memos, layout), [memos, layout]);
  const current = boards.find((board) => board.name === boardParam) ?? boards[0];
  const listOrder = current?.lists.map((list) => list.name) ?? [];
  // Lists come from card tags, so a list whose last card moves away would disappear. Remember what is shown.
  const listOrderKey = listOrder.join("\n");
  useEffect(() => {
    if (current && listOrder.length > 0 && layoutLoaded) rememberLists(current.name, listOrder);
  }, [current?.name, listOrderKey, layoutLoaded, rememberLists]);
  const openMemo = openCard ? memos.find((memo) => memo.name === openCard.memo.name) : undefined;

  const submitNewBoard = (event: FormEvent) => {
    event.preventDefault();
    const name = normalizeBoardSegment(newBoard);
    if (!name) return;
    addBoard(name);
    setNewBoard("");
    navigate(`${ROUTES.BOARDS}/${encodeURIComponent(name)}`);
  };

  return (
    <div className="flex w-full flex-col gap-4">
      <header className="flex flex-wrap items-center gap-2 px-1">
        <LayoutDashboardIcon className="size-5 text-muted-foreground" strokeWidth={1.8} />
        <h1 className="me-2 text-xl font-semibold tracking-tight text-foreground">{t("board.title")}</h1>
        <nav aria-label={t("board.title")} className="flex flex-wrap items-center gap-1">
          {boards.map((board) => (
            <Link
              key={board.name}
              to={`${ROUTES.BOARDS}/${encodeURIComponent(board.name)}`}
              aria-current={board.name === current?.name ? "page" : undefined}
              className={cn(
                "rounded-md px-2.5 py-1 text-sm transition-colors",
                board.name === current?.name
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
              )}
            >
              {formatBoardSegment(board.name)}
            </Link>
          ))}
        </nav>
        <form onSubmit={submitNewBoard} className="ms-auto flex items-center gap-1">
          <Input
            value={newBoard}
            className="h-8 w-40"
            placeholder={t("board.new-board-placeholder")}
            aria-label={t("board.new-board-placeholder")}
            onChange={(event) => setNewBoard(event.target.value)}
          />
          <Button type="submit" size="sm" variant="ghost" disabled={!normalizeBoardSegment(newBoard)}>
            <PlusIcon className="size-4" />
            {t("board.new-board")}
          </Button>
        </form>
      </header>

      {current ? (
        <BoardView
          key={current.name}
          board={current}
          onOpenCard={setOpenCard}
          onAddList={(list) => addList(current.name, list, listOrder)}
          onMoveList={(list, direction) => moveList(current.name, list, direction, listOrder)}
          onRemoveList={(list) => removeList(current.name, list)}
        />
      ) : (
        !isLoading && <p className="px-1 text-sm text-muted-foreground">{t("board.empty-hint")}</p>
      )}

      <BoardCardDialog memo={openMemo} board={current?.name ?? ""} onClose={() => setOpenCard(null)} />
    </div>
  );
};

export default Boards;
