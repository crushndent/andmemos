import { timestampDate, timestampFromDate } from "@bufbuild/protobuf/wkt";
import dayjs from "dayjs";
import { XIcon } from "lucide-react";
import toast from "react-hot-toast";
import MemoView from "@/components/MemoView";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useUpdateMemo } from "@/hooks/useMemoQueries";
import { getCardTitle } from "@/lib/board";
import { handleError } from "@/lib/error";
import type { Memo } from "@/types/proto/api/v1/memo_service_pb";
import { useTranslate } from "@/utils/i18n";

interface Props {
  memo: Memo | undefined;
  board: string;
  onClose: () => void;
}

const DATE_INPUT_FORMAT = "YYYY-MM-DDTHH:mm";

/** The full card: its due date and the complete memo (content, attachments, comments, editing). */
const BoardCardDialog = ({ memo, board, onClose }: Props) => {
  const t = useTranslate();
  const { mutateAsync: updateMemo } = useUpdateMemo();

  const setDue = async (due: Date | undefined) => {
    if (!memo) return;
    try {
      await updateMemo({
        update: { name: memo.name, dueTime: due ? timestampFromDate(due) : undefined },
        updateMask: ["due_time"],
      });
    } catch (error: unknown) {
      handleError(error, toast.error, { context: "Set due date", fallbackMessage: "An error occurred" });
    }
  };

  const due = memo?.dueTime ? timestampDate(memo.dueTime) : undefined;

  return (
    <Dialog open={memo !== undefined} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        {memo && (
          <div className="flex flex-col gap-3">
            <DialogTitle className="pe-8 text-base">{getCardTitle(memo) || memo.snippet}</DialogTitle>
            <DialogDescription className="sr-only">{t("board.card-description", { board })}</DialogDescription>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <label htmlFor="board-card-due" className="text-muted-foreground">
                {t("board.due-date")}
              </label>
              <input
                id="board-card-due"
                type="datetime-local"
                className="rounded-md border border-border bg-transparent px-2 py-1 text-sm"
                defaultValue={due ? dayjs(due).format(DATE_INPUT_FORMAT) : ""}
                key={due?.getTime() ?? "none"}
                onBlur={(event) => {
                  const value = event.target.value;
                  if (!value) return;
                  const next = dayjs(value).toDate();
                  if (!Number.isNaN(next.getTime()) && next.getTime() !== due?.getTime()) void setDue(next);
                }}
              />
              {due && (
                <Button variant="ghost" size="sm" onClick={() => void setDue(undefined)} aria-label={t("board.clear-due-date")}>
                  <XIcon className="size-3.5" />
                  {t("board.clear-due-date")}
                </Button>
              )}
            </div>
            <MemoView memo={memo} showVisibility showSpace />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default BoardCardDialog;
