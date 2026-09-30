import { describe, expect, it } from "vitest";
import { getPinnedSectionBreakKey } from "@/components/PagedMemoList";
import type { Memo } from "@/types/proto/api/v1/memo_service_pb";

const memo = (name: string, pinned: boolean) => ({ name, pinned }) as Memo;

describe("getPinnedSectionBreakKey", () => {
  it("returns the first unpinned memo after the pinned run", () => {
    expect(getPinnedSectionBreakKey([memo("a", true), memo("b", true), memo("c", false), memo("d", false)])).toBe("c");
  });

  it("returns undefined when nothing is pinned", () => {
    expect(getPinnedSectionBreakKey([memo("a", false), memo("b", false)])).toBeUndefined();
  });

  it("returns undefined when everything is pinned (nothing below to separate)", () => {
    expect(getPinnedSectionBreakKey([memo("a", true), memo("b", true)])).toBeUndefined();
  });

  it("returns undefined for an empty list", () => {
    expect(getPinnedSectionBreakKey([])).toBeUndefined();
  });

  it("ignores pinned memos that are not a leading run", () => {
    expect(getPinnedSectionBreakKey([memo("a", false), memo("b", true), memo("c", false)])).toBeUndefined();
  });

  it("looks past a just-created unpinned memo hoisted above the pins", () => {
    const list = [memo("new", false), memo("a", true), memo("b", false)];
    expect(getPinnedSectionBreakKey(list, { skipKey: "new" })).toBe("b");
    expect(getPinnedSectionBreakKey(list)).toBeUndefined();
  });
});
