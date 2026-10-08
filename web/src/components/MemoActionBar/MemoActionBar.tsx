import { ArchiveIcon, ArchiveRestoreIcon, BookmarkMinusIcon, BookmarkPlusIcon, Edit3Icon, MessageSquarePlusIcon } from "lucide-react";
import type { ReactNode } from "react";
import MemoActionMenu from "@/components/MemoActionMenu";
import { useMemoActionHandlers } from "@/components/MemoActionMenu/hooks";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { State } from "@/types/proto/api/v1/common_pb";
import type { Memo } from "@/types/proto/api/v1/memo_service_pb";
import { useTranslate } from "@/utils/i18n";

interface Props {
  memo: Memo;
  parentPage?: string;
  /** The viewer cannot change this memo (not the owner, or a shared link). */
  readonly: boolean;
  onEdit: () => void;
  /** Present only when the viewer may comment. */
  onComment?: () => void;
  className?: string;
}

const noop = () => undefined;

interface BarButtonProps {
  icon: ReactNode;
  label: string;
  onClick: () => void;
}

/** Icon always; the label joins it when there is room, but stays available to assistive tech and as a tooltip. */
const BarButton = ({ icon, label, onClick }: BarButtonProps) => (
  <Button variant="ghost" size="sm" onClick={onClick} title={label} aria-label={label} className="gap-1.5">
    {icon}
    <span className="hidden sm:inline">{label}</span>
  </Button>
);

/**
 * The memo page's actions, pinned to the bottom of the screen so they stay in reach however long
 * the memo is. On wide screens it is inset by the sidebar and centered under the memo.
 */
const MemoActionBar = ({ memo, parentPage, readonly, onEdit, onComment, className }: Props) => {
  const t = useTranslate();
  const isArchived = memo.state === State.ARCHIVED;
  const isComment = Boolean(memo.parent);
  const { handleTogglePinMemoBtnClick, handleToggleMemoStatusClick } = useMemoActionHandlers({
    memo,
    parentPage,
    onEdit,
    setDeleteDialogOpen: noop,
  });

  const canEdit = !readonly && !isArchived;
  const canArchiveOrRestore = !readonly && !isComment;
  const canPin = canEdit && !isComment;

  return (
    <div
      data-slot="memo-action-bar"
      role="toolbar"
      aria-label={t("common.actions")}
      className={cn(
        "pointer-events-none fixed inset-x-0 bottom-0 z-30 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] md:start-(--app-sidebar-width)",
        className,
      )}
    >
      <div className="pointer-events-auto mx-auto flex w-full max-w-2xl items-center justify-between gap-1 rounded-xl border border-border/70 bg-background/95 p-1 shadow-lg backdrop-blur-md">
        <div className="flex min-w-0 items-center gap-0.5">
          {canEdit && <BarButton icon={<Edit3Icon className="size-4" />} label={t("common.edit")} onClick={onEdit} />}
          {onComment && !isArchived && (
            <BarButton icon={<MessageSquarePlusIcon className="size-4" />} label={t("memo.comment.self")} onClick={onComment} />
          )}
          {canPin && (
            <BarButton
              icon={memo.pinned ? <BookmarkMinusIcon className="size-4" /> : <BookmarkPlusIcon className="size-4" />}
              label={memo.pinned ? t("common.unpin") : t("common.pin")}
              onClick={() => void handleTogglePinMemoBtnClick()}
            />
          )}
          {canArchiveOrRestore && (
            <BarButton
              icon={isArchived ? <ArchiveRestoreIcon className="size-4" /> : <ArchiveIcon className="size-4" />}
              label={isArchived ? t("common.restore") : t("common.archive")}
              onClick={() => void handleToggleMemoStatusClick()}
            />
          )}
        </div>
        <MemoActionMenu memo={memo} parentPage={parentPage} readonly={readonly} onEdit={onEdit} />
      </div>
    </div>
  );
};

export default MemoActionBar;
