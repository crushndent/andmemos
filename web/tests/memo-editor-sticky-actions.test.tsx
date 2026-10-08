import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import MemoEditor from "@/components/MemoEditor";

vi.mock("@/utils/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/i18n")>()),
  useTranslate: () => (key: string) => key,
}));
vi.mock("@/hooks/useUserQueries", () => ({ useTagCounts: () => ({ data: {} }) }));
vi.mock("@/hooks/useCurrentUser", () => ({ default: () => ({ name: "users/1" }) }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ userGeneralSetting: {} }) }));
vi.mock("@/contexts/InstanceContext", () => ({
  useInstance: () => ({ aiSetting: { providers: [], transcription: undefined }, fetchSetting: vi.fn().mockResolvedValue(undefined) }),
}));
vi.mock("@/contexts/NewMemoContext", () => ({ useNewMemo: () => ({ markNewMemo: vi.fn() }) }));
vi.mock("@/connect", () => ({ attachmentServiceClient: {}, memoServiceClient: {}, userServiceClient: {} }));
vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

const mount = (props: { onCancel?: () => void; pinActionsToScreen?: boolean } = {}) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoEditor cacheKey="sticky-test" onCancel={props.onCancel} pinActionsToScreen={props.pinActionsToScreen} />
    </QueryClientProvider>,
  );

describe("MemoEditor action rail", () => {
  it("holds the commit and cancel buttons in a rail that sticks to the bottom of the screen", () => {
    const { container, getByRole } = mount({ onCancel: vi.fn() });
    const rail = container.querySelector<HTMLElement>('[data-slot="editor-actions"]');

    expect(rail).not.toBeNull();
    expect(rail).toHaveClass("sticky", "bottom-0", "bg-card");
    expect(rail).toContainElement(getByRole("button", { name: "editor.save" }));
    expect(rail).toContainElement(getByRole("button", { name: "common.cancel" }));
  });

  it("spans the card so nothing shows beside or beneath it when stuck", () => {
    const { container } = mount();
    const rail = container.querySelector<HTMLElement>('[data-slot="editor-actions"]');
    // The card pads 16px sideways and 12px below; the rail cancels both.
    expect(rail).toHaveClass("-mx-4", "-mb-3", "px-4", "pb-3");
  });

  it("is a direct child of the card, because a sticky element cannot leave its parent", () => {
    const { container } = mount();
    const rail = container.querySelector<HTMLElement>('[data-slot="editor-actions"]') as HTMLElement;
    // The card is the editor's tall flex column; a rail nested in a short wrapper could only stick inside that wrapper.
    expect(rail.parentElement).toHaveClass("group", "relative", "rounded-lg", "bg-card");
  });

  it("stays in the card by default (sticky) and is not pinned", () => {
    const { container } = mount();
    const rail = container.querySelector<HTMLElement>('[data-slot="editor-actions"]');
    expect(rail).toHaveAttribute("data-pinned", "false");
    expect(rail).not.toHaveClass("fixed");
  });

  it("pins the buttons to the bottom of the screen on a memo's own page, centered beside the sidebar", () => {
    const { container, getByRole } = mount({ onCancel: vi.fn(), pinActionsToScreen: true });
    const rail = container.querySelector<HTMLElement>('[data-slot="editor-actions"]') as HTMLElement;

    expect(rail).toHaveAttribute("data-pinned", "true");
    expect(rail).toHaveClass("fixed", "bottom-2", "z-30", "left-1/2", "-translate-x-1/2");
    expect(rail).not.toHaveClass("sticky");
    expect(rail.className).toContain("md:left-[calc(50%+var(--app-sidebar-width,0px)/2)]");
    expect(rail).toContainElement(getByRole("button", { name: "editor.save" }));
    expect(rail).toContainElement(getByRole("button", { name: "common.cancel" }));
  });

  it("is not clipped by an overflow container between it and the page", () => {
    const { container } = mount();
    const rail = container.querySelector<HTMLElement>('[data-slot="editor-actions"]') as HTMLElement;
    // A scrolling or clipping ancestor would anchor "sticky" to itself instead of the screen.
    for (let el = rail.parentElement; el && el !== container.parentElement; el = el.parentElement) {
      expect(el.className, el.className).not.toMatch(/\boverflow-(hidden|auto|scroll|clip)\b/);
    }
  });
});
