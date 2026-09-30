import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { ROUTES, resolveCollectionRoute } from "@/router/routes";

export type MemoTimeBasis = "create_time" | "update_time";

/** Upper bound on feed columns, in display order. 1 = single reading column; 0 = as many as fit. */
export const MAX_COLUMNS_VALUES = [1, 2, 3, 0] as const;
export type MemoMaxColumns = (typeof MAX_COLUMNS_VALUES)[number];

/** Font family used for memo card content. */
export const CARD_FONT_VALUES = ["sans", "serif", "mono"] as const;
export type MemoCardFont = (typeof CARD_FONT_VALUES)[number];

interface ViewState {
  orderByTimeAsc: boolean;
  timeBasis?: MemoTimeBasis;
  sortTimeField?: MemoTimeBasis;
  compactMode: boolean;
  linkPreview: boolean;
  maxColumns: MemoMaxColumns;
  cardFont: MemoCardFont;
}

interface ViewContextValue {
  orderByTimeAsc: boolean;
  timeBasis: MemoTimeBasis;
  compactMode: boolean;
  linkPreview: boolean;
  maxColumns: MemoMaxColumns;
  cardFont: MemoCardFont;
  setOrderByTimeAsc: (value: boolean) => void;
  setTimeBasis: (field: MemoTimeBasis) => void;
  setCompactMode: (value: boolean) => void;
  setLinkPreview: (value: boolean) => void;
  setMaxColumns: (value: MemoMaxColumns) => void;
  setCardFont: (value: MemoCardFont) => void;
}

const ViewContext = createContext<ViewContextValue | null>(null);

const LOCAL_STORAGE_KEY = "memos-view-setting";

const DEFAULT_VIEW_STATE: ViewState = { orderByTimeAsc: false, compactMode: false, linkPreview: true, maxColumns: 0, cardFont: "sans" };

export function ViewProvider({ children, enabled = true }: { children: ReactNode; enabled?: boolean }) {
  const getInitialState = (): ViewState => {
    try {
      const cached = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (cached) {
        const data = JSON.parse(cached) as Partial<ViewState>;
        const cachedTimeBasis = data.timeBasis ?? data.sortTimeField;
        const timeBasis = cachedTimeBasis === "create_time" || cachedTimeBasis === "update_time" ? cachedTimeBasis : undefined;
        const maxColumns = MAX_COLUMNS_VALUES.includes(data.maxColumns as MemoMaxColumns)
          ? (data.maxColumns as MemoMaxColumns)
          : DEFAULT_VIEW_STATE.maxColumns;
        return {
          orderByTimeAsc: Boolean(data.orderByTimeAsc ?? DEFAULT_VIEW_STATE.orderByTimeAsc),
          timeBasis,
          compactMode: Boolean(data.compactMode ?? DEFAULT_VIEW_STATE.compactMode),
          linkPreview: Boolean(data.linkPreview ?? DEFAULT_VIEW_STATE.linkPreview),
          maxColumns,
          cardFont: CARD_FONT_VALUES.includes(data.cardFont as MemoCardFont)
            ? (data.cardFont as MemoCardFont)
            : DEFAULT_VIEW_STATE.cardFont,
        };
      }
    } catch (error) {
      console.warn("Failed to load view settings from localStorage:", error);
    }
    return { ...DEFAULT_VIEW_STATE };
  };

  const [viewState, setViewState] = useState(getInitialState);
  // Keep the saved Timeline preferences while other views use their default presentation.
  const activeState = enabled ? viewState : DEFAULT_VIEW_STATE;
  const timeBasis = activeState.timeBasis ?? "create_time";

  const persistToStorage = (newState: ViewState) => {
    try {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(newState));
    } catch (error) {
      console.warn("Failed to persist view settings:", error);
    }
  };

  const updateState = (patch: Partial<ViewState>) => {
    setViewState((prev) => {
      const newState = { ...prev, ...patch };
      persistToStorage(newState);
      return newState;
    });
  };

  const setOrderByTimeAsc = (value: boolean) => updateState({ orderByTimeAsc: value });
  const setTimeBasis = (field: MemoTimeBasis) => updateState({ timeBasis: field });
  const setCompactMode = (value: boolean) => updateState({ compactMode: value });
  const setLinkPreview = (value: boolean) => updateState({ linkPreview: value });
  const setMaxColumns = (value: MemoMaxColumns) => updateState({ maxColumns: value });
  const setCardFont = (value: MemoCardFont) => updateState({ cardFont: value });

  // Card text is styled from a root attribute (see index.css) so no card needs to subscribe to the view.
  const { cardFont } = activeState;
  useEffect(() => {
    document.documentElement.dataset.cardFont = cardFont;
    return () => {
      delete document.documentElement.dataset.cardFont;
    };
  }, [cardFont]);

  return (
    <ViewContext.Provider
      value={{
        orderByTimeAsc: activeState.orderByTimeAsc,
        timeBasis,
        compactMode: activeState.compactMode,
        linkPreview: activeState.linkPreview,
        maxColumns: activeState.maxColumns,
        cardFont,
        setOrderByTimeAsc,
        setTimeBasis,
        setCompactMode,
        setLinkPreview,
        setMaxColumns,
        setCardFont,
      }}
    >
      {children}
    </ViewContext.Provider>
  );
}

/** Timeline preferences also apply to its sidebar statistics and date filters. */
export function TimelineViewProvider({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const route = resolveCollectionRoute(pathname);
  const collectionPath = route.pathname.toLowerCase();
  const enabled = route.isCollection && (collectionPath === ROUTES.HOME || collectionPath === ROUTES.EXPLORE);
  return <ViewProvider enabled={enabled}>{children}</ViewProvider>;
}

export function useView() {
  const context = useContext(ViewContext);
  if (!context) {
    throw new Error("useView must be used within ViewProvider");
  }
  return context;
}

// Read the link-preview preference from deep inside the markdown renderer, which
// can render outside a ViewProvider (tests, isolated previews). Defaults to
// enabled when no provider is present, preserving the historical behavior.
export function useLinkPreviewEnabled() {
  return useContext(ViewContext)?.linkPreview ?? DEFAULT_VIEW_STATE.linkPreview;
}
