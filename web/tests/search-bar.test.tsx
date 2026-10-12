import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SearchBar, { shouldShowSearchBar } from "@/components/SearchBar";
import type { MemoFilter } from "@/contexts/MemoFilterContext";

const state = vi.hoisted(() => ({
  filters: [] as MemoFilter[],
  memoView: undefined as string | undefined,
  clearAllFilters: vi.fn(),
  setQuickFindOpen: vi.fn(),
}));

vi.mock("@/contexts/MemoFilterContext", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/contexts/MemoFilterContext")>()),
  useMemoFilterContext: () => ({ filters: state.filters, memoView: state.memoView, clearAllFilters: state.clearAllFilters }),
}));
vi.mock("@/contexts/AppSidebarContext", () => ({ useAppSidebar: () => ({ setQuickFindOpen: state.setQuickFindOpen }) }));
vi.mock("@/utils/i18n", () => ({
  useTranslate: () => (key: string, params?: { n?: number }) => (params?.n !== undefined ? `${key}:${params.n}` : key),
}));

const renderBar = (path = "/") =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <SearchBar />
    </MemoryRouter>,
  );

beforeEach(() => {
  state.filters = [];
  state.memoView = undefined;
  state.clearAllFilters.mockClear();
  state.setQuickFindOpen.mockClear();
});

describe("shouldShowSearchBar", () => {
  it.each([
    "/",
    "/explore",
    "/archived",
    "/calendar/2026/08",
    "/map",
    "/boards",
    "/boards/work",
    "/attachments",
    "/views",
  ])("is on for the searchable page %s", (path) => expect(shouldShowSearchBar(path, false)).toBe(true));

  it.each(["/setting", "/inbox", "/memos/abc", "/about", "/auth"])("is off for %s unless something is filtered", (path) => {
    expect(shouldShowSearchBar(path, false)).toBe(false);
    expect(shouldShowSearchBar(path, true)).toBe(true);
  });
});

describe("<SearchBar>", () => {
  it("invites a search when nothing is applied, with no clear button", () => {
    renderBar();
    expect(screen.getByText("search.bar-placeholder")).toBeInTheDocument();
    expect(screen.getByRole("search").querySelector("[data-active]")).toHaveAttribute("data-active", "false");
    expect(screen.queryByRole("button", { name: "search.bar-clear" })).not.toBeInTheDocument();
  });

  it("opens Quick Find when clicked", () => {
    renderBar();
    fireEvent.click(screen.getByRole("button", { name: "common.search" }));
    expect(state.setQuickFindOpen).toHaveBeenCalledWith(true);
  });

  it("shows the search that is applied, how many things filter the list, and clears them all at once", () => {
    state.filters = [
      { factor: "contentSearch", value: "invoice" },
      { factor: "tagSearch", value: "work" },
    ];
    renderBar();

    expect(screen.getByText("invoice")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveAttribute("aria-label", "search.bar-status:2");
    expect(screen.getByRole("search").querySelector("[data-active]")).toHaveAttribute("data-active", "true");

    fireEvent.click(screen.getByRole("button", { name: "search.bar-clear" }));
    expect(state.clearAllFilters).toHaveBeenCalledOnce();
  });

  it("clicking an active bar edits the search", () => {
    state.filters = [{ factor: "contentSearch", value: "invoice" }];
    renderBar();
    fireEvent.click(screen.getByRole("button", { name: "search.bar-edit" }));
    expect(state.setQuickFindOpen).toHaveBeenCalledWith(true);
  });

  it("shows a regex between slashes", () => {
    state.filters = [{ factor: "regexSearch", value: "^todo" }];
    renderBar();
    expect(screen.getByText("/^todo/")).toBeInTheDocument();
  });

  it("says 'filtered' when only a facet is applied", () => {
    state.filters = [{ factor: "tagSearch", value: "work" }];
    renderBar();
    expect(screen.getByText("search.bar-filters-only")).toBeInTheDocument();
  });

  it("stays visible with an active filter on a page that is not normally searchable", () => {
    state.filters = [{ factor: "contentSearch", value: "x" }];
    renderBar("/setting");
    expect(screen.getByRole("search")).toBeInTheDocument();
  });

  it("renders nothing on a page that cannot be filtered", () => {
    renderBar("/setting");
    expect(screen.queryByRole("search")).not.toBeInTheDocument();
  });

  it("does not count a remembered view on a page it does not apply to", () => {
    state.memoView = "views/1";
    renderBar("/boards");
    expect(screen.getByText("search.bar-placeholder")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("counts a selected view on a memo list", () => {
    state.memoView = "views/1";
    renderBar("/");
    expect(screen.getByRole("status")).toHaveAttribute("aria-label", "search.bar-status:1");
  });
});
