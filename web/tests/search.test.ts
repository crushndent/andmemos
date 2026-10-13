import { describe, expect, it } from "vitest";
import { buildQuickFindFilters, readQuickFindQuery, resolveQuickFindSubmission } from "@/components/AppSidebar/QuickFindDialog";
import { type MemoFilter, parseFilterQuery, stringifyFilters } from "@/contexts/MemoFilterContext";
import { buildMemoFilter } from "@/hooks/useMemoFilters";
import { buildRegexExpression, checkRegexPattern, describeSearchFilter, MAX_REGEX_LENGTH, summarizeActiveFilters } from "@/lib/search";

describe("checkRegexPattern", () => {
  it.each([
    "^TODO",
    "invoice \\d{4}",
    "colou?r|gray",
    "a.*b",
    "\\(literal\\)",
    "[a-z]+@example\\.com",
    "\\\\1 is a backslash then 1",
  ])("accepts %s", (pattern) => {
    expect(checkRegexPattern(pattern)).toEqual({ ok: true });
  });

  it("rejects blank, over-long and malformed patterns", () => {
    expect(checkRegexPattern("   ")).toEqual({ ok: false, issue: "empty" });
    expect(checkRegexPattern("a".repeat(MAX_REGEX_LENGTH + 1))).toEqual({ ok: false, issue: "too-long" });
    expect(checkRegexPattern("(unclosed")).toEqual({ ok: false, issue: "invalid" });
    expect(checkRegexPattern("[z-a]")).toEqual({ ok: false, issue: "invalid" });
  });

  it("rejects what the server's regex engine cannot run", () => {
    for (const pattern of ["foo(?=bar)", "foo(?!bar)", "(?<=\\$)\\d+", "(?<!x)y"]) {
      expect(checkRegexPattern(pattern), pattern).toEqual({ ok: false, issue: "lookaround" });
    }
    expect(checkRegexPattern("(a)\\1")).toEqual({ ok: false, issue: "backreference" });
    expect(checkRegexPattern("(?<w>a)\\k<w>")).toEqual({ ok: false, issue: "backreference" });
  });
});

describe("regex search filter", () => {
  it("is case-insensitive by default, like plain search, and escapes safely", () => {
    expect(buildRegexExpression("  ^todo  ")).toBe('content.matches("(?i)^todo")');
    expect(buildRegexExpression('say "hi"\\d')).toBe('content.matches("(?i)say \\"hi\\"\\\\d")');
  });

  it("becomes a CEL condition next to the other filters", () => {
    const filters: MemoFilter[] = [
      { factor: "tagSearch", value: "work" },
      { factor: "regexSearch", value: "^todo" },
    ];
    expect(buildMemoFilter({ filters, includePinned: false })).toBe(
      '(!(tag in ["board-layout"])) && (tag in ["work"]) && (content.matches("(?i)^todo"))',
    );
  });

  it("survives the URL round trip, including characters that are special in a query", () => {
    const filters: MemoFilter[] = [{ factor: "regexSearch", value: "a,b:c|d&e=f%20" }];
    expect(parseFilterQuery(stringifyFilters(filters))).toEqual(filters);
  });
});

describe("Quick Find regex mode", () => {
  it("submits a regexSearch and keeps facets, replacing earlier searches", () => {
    const current: MemoFilter[] = [
      { factor: "tagSearch", value: "work" },
      { factor: "contentSearch", value: "old" },
      { factor: "celSearch", value: "pinned" },
    ];
    expect(buildQuickFindFilters("  ^todo  ", current, true, "regex")).toEqual([
      { factor: "tagSearch", value: "work" },
      { factor: "regexSearch", value: "^todo" },
    ]);
    expect(buildQuickFindFilters("   ", current, true, "regex")).toEqual([{ factor: "tagSearch", value: "work" }]);
  });

  it("reads the active regex back into the box", () => {
    expect(readQuickFindQuery([{ factor: "regexSearch", value: "^todo" }])).toEqual({ query: "^todo", mode: "regex" });
  });

  it("carries the regex through navigation to a memo list", () => {
    const submission = resolveQuickFindSubmission("/attachments", "a|b", [], "regex");
    expect(parseFilterQuery(new URL(submission.destination!, "https://memos.test").searchParams.get("filter"))).toEqual([
      { factor: "regexSearch", value: "a|b" },
    ]);
  });

  it("searches a board in place instead of leaving it", () => {
    const submission = resolveQuickFindSubmission("/boards/work", "bug", [], "text");
    expect(submission.destination).toBeUndefined();
    expect(submission.filters).toEqual([{ factor: "contentSearch", value: "bug" }]);
  });
});

describe("summarizeActiveFilters", () => {
  it("is empty without filters", () => {
    expect(summarizeActiveFilters([], false)).toEqual({ query: "", count: 0, kind: "none" });
  });

  it("describes each kind of search and counts everything narrowing the list", () => {
    expect(
      summarizeActiveFilters(
        [
          { factor: "contentSearch", value: "a" },
          { factor: "contentSearch", value: "b" },
        ],
        false,
      ),
    ).toEqual({
      query: "a b",
      count: 2,
      kind: "text",
    });
    expect(
      summarizeActiveFilters(
        [
          { factor: "regexSearch", value: "^x" },
          { factor: "tagSearch", value: "t" },
        ],
        true,
      ),
    ).toEqual({
      query: "/^x/",
      count: 3,
      kind: "regex",
    });
    expect(summarizeActiveFilters([{ factor: "celSearch", value: "pinned\n  || has_link" }], false)).toEqual({
      query: "pinned || has_link",
      count: 1,
      kind: "cel",
    });
  });

  it("counts a facet or a view even when there is no search text", () => {
    expect(summarizeActiveFilters([{ factor: "tagSearch", value: "work" }], false)).toEqual({ query: "", count: 1, kind: "none" });
    expect(summarizeActiveFilters([], true)).toEqual({ query: "", count: 1, kind: "none" });
  });

  it("shows a regex between slashes", () => {
    expect(describeSearchFilter({ factor: "regexSearch", value: "a+" })).toBe("/a+/");
    expect(describeSearchFilter({ factor: "contentSearch", value: "word" })).toBe("word");
  });
});
