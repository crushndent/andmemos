import { create } from "@bufbuild/protobuf";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import MemoDetail from "@/pages/MemoDetail";
import { State } from "@/types/proto/api/v1/common_pb";
import { type Memo, MemoSchema } from "@/types/proto/api/v1/memo_service_pb";

const state = vi.hoisted(() => ({
  currentUser: undefined as { name: string; role?: number } | undefined,
  getMemo: vi.fn(),
  getSharedMemo: vi.fn(),
  listMemoComments: vi.fn(),
  setMemoDetail: vi.fn(),
}));
vi.mock("@/connect", () => ({ memoServiceClient: state }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ currentUser: state.currentUser, isInitialized: true }) }));
vi.mock("@/contexts/InstanceContext", () => ({ useInstance: () => ({ isInitialized: true }) }));
vi.mock("@/contexts/AppSidebarContext", () => ({ useAppSidebar: () => ({ setMemoDetail: state.setMemoDetail }) }));
vi.mock("@/components/MemoView", () => ({
  default: ({
    memo,
    onEditorOpenChange,
    pinEditorActions,
  }: {
    memo: Memo;
    onEditorOpenChange?: (open: boolean) => void;
    pinEditorActions?: boolean;
  }) => (
    <article data-pin-editor-actions={String(Boolean(pinEditorActions))}>
      {memo.content}
      <button type="button" onClick={() => onEditorOpenChange?.(true)}>
        start editing
      </button>
      <button type="button" onClick={() => onEditorOpenChange?.(false)}>
        stop editing
      </button>
    </article>
  ),
}));
vi.mock("@/components/MemoView/MemoViewContext", () => ({ computeCommentAmount: () => 0 }));
vi.mock("@/components/MemoCommentSection", () => ({ default: () => null }));
vi.mock("@/components/MemoActionBar", () => ({
  default: ({ readonly, onComment }: { readonly: boolean; onComment?: () => void }) => (
    <div role="toolbar" data-readonly={String(readonly)} data-can-comment={String(Boolean(onComment))} />
  ),
}));
vi.mock("@/components/MemoContent/MentionResolutionContext", () => ({
  MentionResolutionProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/utils/i18n", () => ({ useTranslate: () => (key: string) => key }));
vi.mock("react-hot-toast", () => ({ toast: { error: vi.fn() } }));

const memo = (extra: Partial<Memo> = {}) =>
  create(MemoSchema, { name: "memos/one", content: "Body", creator: "users/alice", state: State.NORMAL, ...extra } as Record<
    string,
    unknown
  >);

const renderAt = async (path: string) => {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/memos/:uid" element={<MemoDetail />} />
          <Route path="/memos/shares/:token" element={<MemoDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await screen.findByText("Body", { exact: false });
};

beforeEach(() => {
  vi.clearAllMocks();
  state.currentUser = { name: "users/alice" };
  state.getMemo.mockResolvedValue(memo());
  state.getSharedMemo.mockResolvedValue(memo());
  state.listMemoComments.mockResolvedValue({ memos: [], nextPageToken: "" });
});

describe("memo page action bar", () => {
  it("shows the bar while viewing, and reserves room so it does not cover the end of the memo", async () => {
    await renderAt("/memos/one");
    expect(screen.getByRole("toolbar")).toHaveAttribute("data-readonly", "false");
    expect(screen.getByRole("toolbar")).toHaveAttribute("data-can-comment", "true");
    expect(document.querySelector("section")).toHaveClass("pb-24");
  });

  it("gives way to the editor's own Update and Cancel while editing, and returns afterwards", async () => {
    await renderAt("/memos/one");
    fireEvent.click(screen.getByRole("button", { name: "start editing" }));
    expect(screen.queryByRole("toolbar")).not.toBeInTheDocument();
    // The editor's buttons are pinned to the screen bottom in the bar's place, so the room stays reserved.
    expect(document.querySelector("section")).toHaveClass("pb-24");

    await act(async () => fireEvent.click(screen.getByRole("button", { name: "stop editing" })));
    expect(screen.getByRole("toolbar")).toBeInTheDocument();
  });

  it("asks the inline editor to pin its own buttons to the bottom of the screen", async () => {
    await renderAt("/memos/one");
    expect(document.querySelector("article")).toHaveAttribute("data-pin-editor-actions", "true");
  });

  it("treats someone else's memo as read-only", async () => {
    state.currentUser = { name: "users/bob" };
    await renderAt("/memos/one");
    expect(screen.getByRole("toolbar")).toHaveAttribute("data-readonly", "true");
  });

  it("does not offer commenting on an archived memo", async () => {
    state.getMemo.mockResolvedValue(memo({ state: State.ARCHIVED }));
    await renderAt("/memos/one");
    expect(screen.getByRole("toolbar")).toHaveAttribute("data-can-comment", "false");
  });

  it("is absent for signed-out visitors", async () => {
    state.currentUser = undefined;
    await renderAt("/memos/one");
    expect(screen.queryByRole("toolbar")).not.toBeInTheDocument();
  });
});
