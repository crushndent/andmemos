import type { MemoFilter } from "@/contexts/MemoFilterContext";
import { isSearchFilter } from "@/contexts/MemoFilterContext";

/** Longest regular expression the search box accepts. */
export const MAX_REGEX_LENGTH = 500;

export type RegexIssue = "empty" | "too-long" | "invalid" | "lookaround" | "backreference";

export type RegexCheck = { ok: true } | { ok: false; issue: RegexIssue };

/**
 * Checks a pattern before it is sent. The server evaluates patterns with RE2-style engines, which
 * reject lookahead, lookbehind and backreferences even though the browser would accept them, so
 * those are reported up front instead of failing as a server error after submitting.
 */
export const checkRegexPattern = (pattern: string): RegexCheck => {
  const trimmed = pattern.trim();
  if (!trimmed) return { ok: false, issue: "empty" };
  if (trimmed.length > MAX_REGEX_LENGTH) return { ok: false, issue: "too-long" };
  try {
    new RegExp(trimmed);
  } catch {
    return { ok: false, issue: "invalid" };
  }
  // Ignore escaped parentheses/backslashes when looking for the unsupported constructs.
  const unescaped = trimmed.replace(/\\\\|\\[()]/g, "");
  if (/\(\?<?[=!]/.test(unescaped)) return { ok: false, issue: "lookaround" };
  if (/\\[1-9]|\\k</.test(unescaped)) return { ok: false, issue: "backreference" };
  return { ok: true };
};

/** The filter expression for a regex search: case-insensitive like plain search, unless the pattern says `(?-i)`. */
export const buildRegexExpression = (pattern: string): string => `content.matches(${JSON.stringify(`(?i)${pattern.trim()}`)})`;

/** Short human text for one search filter, as shown in the search bar. */
export const describeSearchFilter = (filter: MemoFilter): string => {
  if (filter.factor === "regexSearch") return `/${filter.value}/`;
  return filter.value;
};

export interface ActiveFilterSummary {
  /** The words, pattern or expression being searched, or "" when only facets are applied. */
  query: string;
  /** Number of things narrowing the list: each search term, tag, day, property and a selected view. */
  count: number;
  kind: "text" | "regex" | "cel" | "none";
}

export const summarizeActiveFilters = (filters: MemoFilter[], hasView: boolean): ActiveFilterSummary => {
  const searches = filters.filter(isSearchFilter);
  const regex = searches.find((filter) => filter.factor === "regexSearch");
  const cel = searches.find((filter) => filter.factor === "celSearch");
  const words = searches.filter((filter) => filter.factor === "contentSearch");
  const count = filters.length + (hasView ? 1 : 0);

  if (regex) return { query: describeSearchFilter(regex), count, kind: "regex" };
  if (cel) return { query: cel.value.replace(/\s+/g, " ").trim(), count, kind: "cel" };
  if (words.length > 0) return { query: words.map((filter) => filter.value).join(" "), count, kind: "text" };
  return { query: "", count, kind: "none" };
};
