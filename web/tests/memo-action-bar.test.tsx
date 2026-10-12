import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import MemoActionBar from "@/components/MemoActionBar";
import { State } from "@/types/proto/api/v1/common_pb";
import type { Memo } from "@/types/proto/api/v1/memo_service_pb";

const handlers = vi.hoisted(() => ({ pin: vi.fn(), status: vi.fn() }));

vi.mock("@/components/MemoActionMenu/hooks", () => ({
  useMemoActionHandlers: () => ({ handleTogglePinMemoBtnClick: handlers.pin, handleToggleMemoStatusClick: handlers.status }),
}));
vi.mock("@/components/MemoActionMenu", () => ({
  default: ({ readonly }: { readonly?: boolean }) => <button type="button" aria-label="menu" data-readonly={String(Boolean(readonly))} />,
}));
vi.mock("@/utils/i18n", () => ({ useTranslate: () => (key: string) => key }));

const memo = (extra: Partial<Memo> = {}) => ({ name: "memos/1", state: State.NORMAL, pinned: false, parent: undefined, ...extra }) as Memo;

const renderBar = (props: Partial<React.ComponentProps<typeof MemoActionBar>> = {}) => {
  const onEdit = vi.fn();
  const onComment = vi.fn();
  render(<MemoActionBar memo={memo()} readonly={false} onEdit={onEdit} onComment={onComment} {...props} />);
  return { onEdit, onComment };
};

beforeEach(() => {
  handlers.pin.mockClear();
  handlers.status.mockClear();
});

describe("<MemoActionBar>", () => {
  it("is fixed to the bottom of the screen and inset by the sidebar on wide screens", () => {
    renderBar();
    const bar = screen.getByRole("toolbar");
    expect(bar).toHaveClass("fixed", "bottom-0", "inset-x-0");
    expect(bar.className).toContain("md:start-(--app-sidebar-width)");
  });

  it("offers edit, comment, pin and archive to the owner, plus the menu", () => {
    const { onEdit, onComment } = renderBar();

    fireEvent.click(screen.getByRole("button", { name: "common.edit" }));
    fireEvent.click(screen.getByRole("button", { name: "memo.comment.self" }));
    fireEvent.click(screen.getByRole("button", { name: "common.pin" }));
    fireEvent.click(screen.getByRole("button", { name: "common.archive" }));

    expect(onEdit).toHaveBeenCalledOnce();
    expect(onComment).toHaveBeenCalledOnce();
    expect(handlers.pin).toHaveBeenCalledOnce();
    expect(handlers.status).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "menu" })).toBeInTheDocument();
  });

  it("offers Unpin for a pinned memo", () => {
    renderBar({ memo: memo({ pinned: true }) });
    expect(screen.getByRole("button", { name: "common.unpin" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "common.pin" })).not.toBeInTheDocument();
  });

  it("offers only Restore (and the menu) for an archived memo", () => {
    renderBar({ memo: memo({ state: State.ARCHIVED }) });

    expect(screen.getByRole("button", { name: "common.restore" })).toBeInTheDocument();
    for (const name of ["common.edit", "common.pin", "common.archive", "memo.comment.self"]) {
      expect(screen.queryByRole("button", { name }), name).not.toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole("button", { name: "common.restore" }));
    expect(handlers.status).toHaveBeenCalledOnce();
  });

  it("leaves a viewer who cannot manage the memo with commenting and the menu", () => {
    renderBar({ readonly: true });

    expect(screen.getByRole("button", { name: "memo.comment.self" })).toBeInTheDocument();
    for (const name of ["common.edit", "common.pin", "common.archive"]) {
      expect(screen.queryByRole("button", { name }), name).not.toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: "menu" })).toHaveAttribute("data-readonly", "true");
  });

  it("does not offer pin or archive for a comment, which lives under its parent", () => {
    renderBar({ memo: memo({ parent: "memos/0" }) });

    expect(screen.getByRole("button", { name: "common.edit" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "common.pin" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "common.archive" })).not.toBeInTheDocument();
  });

  it("hides the comment button when the viewer cannot comment", () => {
    renderBar({ onComment: undefined });
    expect(screen.queryByRole("button", { name: "memo.comment.self" })).not.toBeInTheDocument();
  });
});
