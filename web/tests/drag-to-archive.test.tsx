import { act, fireEvent, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { useDragToArchive } from "@/components/MemoView/hooks";
import {
  ARCHIVE_DRAG_MIN_DISTANCE_PX,
  ARCHIVE_EDGE_ZONE_PX,
  DRAG_START_THRESHOLD_PX,
  shouldArchiveOnRelease,
} from "@/components/MemoView/hooks/useDragToArchive";

describe("shouldArchiveOnRelease", () => {
  it("never archives on a rightward or zero drag", () => {
    expect(shouldArchiveOnRelease({ deltaX: 0, cardWidth: 300, pointerX: 5 })).toBe(false);
    expect(shouldArchiveOnRelease({ deltaX: 200, cardWidth: 300, pointerX: 400 })).toBe(false);
  });

  it("archives when released in the left border zone, however short the drag", () => {
    expect(shouldArchiveOnRelease({ deltaX: -20, cardWidth: 300, pointerX: ARCHIVE_EDGE_ZONE_PX })).toBe(true);
  });

  it("archives once dragged 40% of the card width", () => {
    expect(shouldArchiveOnRelease({ deltaX: -119, cardWidth: 300, pointerX: 500 })).toBe(false);
    expect(shouldArchiveOnRelease({ deltaX: -120, cardWidth: 300, pointerX: 500 })).toBe(true);
  });

  it("requires a minimum distance on narrow cards", () => {
    expect(shouldArchiveOnRelease({ deltaX: -(ARCHIVE_DRAG_MIN_DISTANCE_PX - 1), cardWidth: 100, pointerX: 500 })).toBe(false);
    expect(shouldArchiveOnRelease({ deltaX: -ARCHIVE_DRAG_MIN_DISTANCE_PX, cardWidth: 100, pointerX: 500 })).toBe(true);
  });
});

function Card({ enabled = true, onArchive }: { enabled?: boolean; onArchive: () => Promise<boolean> }) {
  const ref = useRef<HTMLElement>(null);
  const handlers = useDragToArchive({ cardRef: ref, enabled, onArchive });
  return (
    <article ref={ref} data-testid="card" {...handlers}>
      <p>note text</p>
      <button type="button">action</button>
    </article>
  );
}

const drag = (target: Element, from: number, to: number, fromY = 100, toY = 100) => {
  fireEvent.pointerDown(target, { pointerId: 1, isPrimary: true, button: 0, pointerType: "mouse", clientX: from, clientY: fromY });
  fireEvent.pointerMove(target, { pointerId: 1, isPrimary: true, clientX: to, clientY: toY });
  fireEvent.pointerUp(target, { pointerId: 1, isPrimary: true, clientX: to, clientY: toY });
};

describe("useDragToArchive", () => {
  it("archives immediately, without a confirmation, when dragged far enough left", async () => {
    const onArchive = vi.fn().mockResolvedValue(true);
    render(<Card onArchive={onArchive} />);

    await act(async () => drag(screen.getByText("note text"), 600, 300));

    expect(onArchive).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("archives when released at the window's left border", async () => {
    const onArchive = vi.fn().mockResolvedValue(true);
    render(<Card onArchive={onArchive} />);

    await act(async () => drag(screen.getByText("note text"), 60, 10));

    expect(onArchive).toHaveBeenCalledTimes(1);
  });

  it("snaps back without archiving on a short drag", () => {
    const onArchive = vi.fn().mockResolvedValue(true);
    render(<Card onArchive={onArchive} />);
    const card = screen.getByTestId("card");

    drag(card, 600, 600 - (DRAG_START_THRESHOLD_PX + 20));

    expect(onArchive).not.toHaveBeenCalled();
    expect(card.style.transform).toBe("");
  });

  it("ignores rightward drags", () => {
    const onArchive = vi.fn().mockResolvedValue(true);
    render(<Card onArchive={onArchive} />);

    drag(screen.getByTestId("card"), 100, 700);

    expect(onArchive).not.toHaveBeenCalled();
  });

  it("treats a mostly vertical gesture as scrolling", () => {
    const onArchive = vi.fn().mockResolvedValue(true);
    render(<Card onArchive={onArchive} />);

    drag(screen.getByTestId("card"), 600, 590, 100, 400);

    expect(onArchive).not.toHaveBeenCalled();
  });

  it("does not start a drag from an interactive control", () => {
    const onArchive = vi.fn().mockResolvedValue(true);
    render(<Card onArchive={onArchive} />);

    drag(screen.getByRole("button", { name: "action" }), 600, 100);

    expect(onArchive).not.toHaveBeenCalled();
  });

  it("does nothing when disabled (read-only, archived, or detail page)", () => {
    const onArchive = vi.fn().mockResolvedValue(true);
    render(<Card enabled={false} onArchive={onArchive} />);

    drag(screen.getByTestId("card"), 600, 100);

    expect(onArchive).not.toHaveBeenCalled();
  });

  it("restores the card when archiving fails", async () => {
    const onArchive = vi.fn().mockResolvedValue(false);
    render(<Card onArchive={onArchive} />);
    const card = screen.getByTestId("card");

    await act(async () => drag(card, 600, 200));

    expect(onArchive).toHaveBeenCalledTimes(1);
    expect(card.style.transform).toBe("");
  });
});
