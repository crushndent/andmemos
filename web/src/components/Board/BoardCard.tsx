import { timestampDate } from "@bufbuild/protobuf/wkt";
import dayjs from "dayjs";
import { CalendarIcon, CheckSquareIcon, PaperclipIcon } from "lucide-react";
import type { DragEvent } from "react";
import {
  type BoardCard as BoardCardModel,
  type DueState,
  getBoardTags,
  getCardTitle,
  getChecklistProgress,
  getDueState,
} from "@/lib/board";
import { cn } from "@/lib/utils";

const DUE_STYLES: Record<DueState, string> = {
  overdue: "bg-destructive/15 text-destructive",
  soon: "bg-amber-500/20 text-amber-700 dark:text-amber-300",
  later: "bg-muted text-muted-foreground",
  done: "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300",
};

interface Props {
  card: BoardCardModel;
  now: Date;
  dragging: boolean;
  onOpen: (card: BoardCardModel) => void;
  onDragStart: (event: DragEvent<HTMLElement>, card: BoardCardModel) => void;
  onDragEnd: () => void;
}

/** A Trello-style tile: title, labels, due date, checklist progress and attachment count. */
const BoardCard = ({ card, now, dragging, onOpen, onDragStart, onDragEnd }: Props) => {
  const { memo } = card;
  const title = getCardTitle(memo);
  const due = memo.dueTime ? timestampDate(memo.dueTime) : undefined;
  const dueState = due ? getDueState(due, now, card.list) : undefined;
  const checklist = getChecklistProgress(memo.content);
  const attachmentCount = memo.attachments.length;
  const labels = memo.tags.filter((tag) => getBoardTags([tag]).length === 0);

  return (
    <article
      data-card={memo.name}
      draggable
      tabIndex={0}
      aria-label={title}
      onDragStart={(event) => onDragStart(event, card)}
      onDragEnd={onDragEnd}
      onClick={() => onOpen(card)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen(card);
        }
      }}
      className={cn(
        "cursor-pointer select-none rounded-md border border-border/70 bg-card p-2.5 text-sm text-card-foreground shadow-sm transition-colors",
        "hover:border-ring/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        dragging && "opacity-40",
      )}
    >
      {labels.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-1">
          {labels.slice(0, 4).map((tag) => (
            <span key={tag} className="rounded-sm bg-primary/10 px-1.5 text-[11px] leading-4 text-primary">
              #{tag}
            </span>
          ))}
        </div>
      )}
      <p className="wrap-break-word whitespace-pre-wrap leading-snug">{title || memo.snippet}</p>
      {(due || checklist || attachmentCount > 0) && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {due && dueState && (
            <span data-due-state={dueState} className={cn("inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5", DUE_STYLES[dueState])}>
              <CalendarIcon className="size-3" />
              {dayjs(due).format(dayjs(due).year() === now.getFullYear() ? "MMM D" : "MMM D, YYYY")}
            </span>
          )}
          {checklist && (
            <span className="inline-flex items-center gap-1" data-checklist={`${checklist.done}/${checklist.total}`}>
              <CheckSquareIcon className="size-3" />
              {checklist.done}/{checklist.total}
            </span>
          )}
          {attachmentCount > 0 && (
            <span className="inline-flex items-center gap-1">
              <PaperclipIcon className="size-3" />
              {attachmentCount}
            </span>
          )}
        </div>
      )}
    </article>
  );
};

export default BoardCard;
