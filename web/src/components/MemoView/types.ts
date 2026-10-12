import type { Memo } from "@/types/proto/api/v1/memo_service_pb";

/** How the header names the memo's time: relative to now, or just the clock time for lists that already name the day. */
export type MemoTimeDisplay = "relative" | "time";

export interface MemoViewProps {
  memo: Memo;
  compact?: boolean;
  timeDisplay?: MemoTimeDisplay;
  showCreator?: boolean;
  showVisibility?: boolean;
  showPinned?: boolean;
  showSpace?: boolean;
  className?: string;
  parentPage?: string;
  shareImageDialogOpen?: boolean;
  onShareImageDialogOpenChange?: (open: boolean) => void;
  /** Reports when the inline editor opens or closes, so a host can swap its own controls for the editor's. */
  onEditorOpenChange?: (open: boolean) => void;
  /** The inline editor pins its buttons to the bottom of the screen; for a memo's own page. */
  pinEditorActions?: boolean;
}

export interface MemoViewHandle {
  openEditor: () => void;
}

export interface MemoHeaderProps {
  timeDisplay?: MemoTimeDisplay;
  showCreator?: boolean;
  showVisibility?: boolean;
  showSpace?: boolean;
}

export interface MemoBodyProps {
  compact?: boolean;
}
