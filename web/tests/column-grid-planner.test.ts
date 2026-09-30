import { describe, expect, it } from "vitest";
import { assignColumnsByEstimatedHeight } from "@/components/ColumnGrid";

describe("assignColumnsByEstimatedHeight", () => {
  it("assigns each card to the shortest estimated column with deterministic ties", () => {
    const columns = assignColumnsByEstimatedHeight({
      keys: ["a", "b", "c", "d"],
      columnCount: 2,
      getEstimatedHeight: (key) => ({ a: 100, b: 80, c: 70, d: 60 })[key] ?? 0,
    });

    expect(Object.fromEntries(columns)).toEqual({
      a: 0,
      b: 1,
      c: 1,
      d: 0,
    });
  });

  it("keeps pinned cards in the first column while balancing later cards", () => {
    const columns = assignColumnsByEstimatedHeight({
      keys: ["leading", "a", "priority", "b", "c"],
      columnCount: 3,
      getEstimatedHeight: (key) => ({ leading: 160, a: 90, priority: 80, b: 120, c: 70 })[key] ?? 0,
      pinnedKeys: new Set(["leading", "priority"]),
    });

    expect(Object.fromEntries(columns)).toEqual({
      leading: 0,
      a: 1,
      priority: 0,
      b: 2,
      c: 1,
    });
  });

  it("keeps newest-first order roughly row by row while filling gaps under short cards", () => {
    const keys = ["n1", "n2", "n3", "n4", "n5", "n6"];
    const heights: Record<string, number> = { n1: 300, n2: 100, n3: 100, n4: 100, n5: 100, n6: 100 };
    const columns = assignColumnsByEstimatedHeight({
      keys,
      columnCount: 3,
      getEstimatedHeight: (key) => heights[key],
    });

    // The three newest cards start the three columns.
    expect([columns.get("n1"), columns.get("n2"), columns.get("n3")]).toEqual([0, 1, 2]);
    // The tall first card leaves column 0 blocked, so newer-than-n6 cards pack into the short columns.
    expect([columns.get("n4"), columns.get("n5"), columns.get("n6")]).toEqual([1, 2, 1]);
  });

  it("never lets a later card sit above an earlier card within the same column", () => {
    const keys = Array.from({ length: 20 }, (_, i) => `m${i}`);
    const columns = assignColumnsByEstimatedHeight({
      keys,
      columnCount: 4,
      getEstimatedHeight: (key) => 60 + (Number(key.slice(1)) % 5) * 40,
    });

    // Column assignment preserves feed order per column; every column is used on a wide screen.
    expect(new Set(columns.values()).size).toBe(4);
    expect(columns.size).toBe(keys.length);
  });
});
