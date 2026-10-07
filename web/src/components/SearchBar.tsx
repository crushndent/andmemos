import { RegexIcon, SearchIcon, XIcon } from "lucide-react";
import { useLocation } from "react-router-dom";
import { getSidebarRouteKind, type SidebarRouteKind } from "@/components/AppSidebar/routes";
import { Button } from "@/components/ui/button";
import { useAppSidebar } from "@/contexts/AppSidebarContext";
import { useMemoFilterContext } from "@/contexts/MemoFilterContext";
import { isMemoCollectionRoute } from "@/lib/memo-views";
import { summarizeActiveFilters } from "@/lib/search";
import { cn } from "@/lib/utils";
import { useTranslate } from "@/utils/i18n";

/** Pages that list memos and so can be searched and filtered. */
const SEARCHABLE_KINDS: readonly SidebarRouteKind[] = ["home", "explore", "archived", "calendar", "map", "boards", "attachments", "views"];

/** The bar belongs on searchable pages, and anywhere else a filter happens to be active so it can always be seen and cleared. */
export const shouldShowSearchBar = (pathname: string, hasActiveFilters: boolean): boolean =>
  hasActiveFilters || SEARCHABLE_KINDS.includes(getSidebarRouteKind(pathname));

/**
 * The one search field of the app. Idle it invites a search; with a search or filter applied it turns
 * accent-colored, says what is applied and offers a single clear button, so state never hides in the URL.
 */
const SearchBar = () => {
  const t = useTranslate();
  const location = useLocation();
  const { filters, memoView, clearAllFilters } = useMemoFilterContext();
  const { setQuickFindOpen } = useAppSidebar();
  // A remembered view only narrows memo-collection routes; elsewhere it is dormant and not "applied".
  const viewApplies = memoView !== undefined && isMemoCollectionRoute(location.pathname);
  const summary = summarizeActiveFilters(filters, viewApplies);
  const active = summary.count > 0;

  if (!shouldShowSearchBar(location.pathname, active)) return null;

  const label = summary.query || (active ? t("search.bar-filters-only") : t("search.bar-placeholder"));
  const Icon = summary.kind === "regex" ? RegexIcon : SearchIcon;

  return (
    <div role="search" className="w-full px-4 pt-3 sm:px-6 md:pt-4">
      <div
        data-active={active}
        className={cn(
          "mx-auto flex h-9 w-full max-w-2xl items-center gap-1 rounded-lg border bg-card pe-1 text-sm transition-colors",
          active ? "border-primary/60 bg-primary/5" : "border-border/70 hover:border-border",
        )}
      >
        <button
          type="button"
          onClick={() => setQuickFindOpen(true)}
          aria-label={active ? t("search.bar-edit") : t("common.search")}
          className="flex h-full min-w-0 flex-1 items-center gap-2 rounded-lg px-3 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <Icon className={cn("size-4 shrink-0", active ? "text-primary" : "text-muted-foreground")} strokeWidth={1.8} />
          <span
            className={cn(
              "min-w-0 truncate",
              active ? "text-foreground" : "text-muted-foreground",
              summary.kind !== "text" && summary.query && "font-mono text-xs",
            )}
            title={summary.query || undefined}
          >
            {label}
          </span>
        </button>
        {active && (
          <>
            <span
              role="status"
              className="shrink-0 rounded-full bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary"
              aria-label={t("search.bar-status", { n: summary.count })}
            >
              {summary.count}
            </span>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={clearAllFilters}
              aria-label={t("search.bar-clear")}
              title={t("search.bar-clear")}
            >
              <XIcon className="size-3.5" />
            </Button>
          </>
        )}
      </div>
    </div>
  );
};

export default SearchBar;
