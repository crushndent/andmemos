import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDragToArchive } from "@/components/MemoView/hooks";
import { isPlainContentClick, useMemoHandlers } from "@/components/MemoView/hooks/useMemoHandlers";

const settings = vi.hoisted(() => ({ enableDoubleClickEdit: false }));
vi.mock("@/contexts/InstanceContext", () => ({ useInstance: () => ({ memoRelatedSetting: settings }) }));

const mouse = (target: Element, init: Partial<MouseEvent> = {}) => ({
  target,
  button: 0,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...init,
});

const note = () => {
  document.body.innerHTML = `
    <div id="content">
      <p id="text">Plain <strong id="bold">bold</strong> text</p>
      <a id="link" href="https://example.com">link</a>
      <span id="tag" class="cursor-pointer">#tag</span>
      <input id="check" type="checkbox" />
      <img id="image" src="x.png" alt="" />
      <button id="copy" type="button">Copy</button>
      <details><summary id="summary">More</summary>hidden</details>
      <span id="inside-link"></span>
    </div>`;
  return (id: string) => document.getElementById(id) as HTMLElement;
};

beforeEach(() => {
  window.getSelection()?.removeAllRanges();
  settings.enableDoubleClickEdit = false;
});
afterEach(() => vi.useRealTimers());

describe("isPlainContentClick", () => {
  it("accepts a click on the note's own text, including nested formatting", () => {
    const el = note();
    expect(isPlainContentClick(mouse(el("text")))).toBe(true);
    expect(isPlainContentClick(mouse(el("bold")))).toBe(true);
  });

  it.each(["link", "tag", "check", "image", "copy", "summary"])("leaves the %s control to do its own job", (id) => {
    const el = note();
    expect(isPlainContentClick(mouse(el(id)))).toBe(false);
  });

  it("ignores other buttons and modified clicks", () => {
    const el = note();
    expect(isPlainContentClick(mouse(el("text"), { button: 2 }))).toBe(false);
    for (const key of ["ctrlKey", "metaKey", "shiftKey", "altKey"] as const) {
      expect(isPlainContentClick(mouse(el("text"), { [key]: true }))).toBe(false);
    }
  });

  it("does not edit when the click ends selecting text to copy", () => {
    const el = note();
    const range = document.createRange();
    range.selectNodeContents(el("text"));
    window.getSelection()?.addRange(range);
    expect(isPlainContentClick(mouse(el("text")))).toBe(false);
  });
});

describe("useMemoHandlers click-to-edit", () => {
  const setup = (readonly = false) => {
    const openEditor = vi.fn();
    const openPreview = vi.fn();
    const { result } = renderHook(() => useMemoHandlers({ readonly, openEditor, openPreview }));
    return { result, openEditor, openPreview };
  };
  const click = (target: Element, handler: (e: React.MouseEvent) => void) =>
    handler({ target, nativeEvent: mouse(target) } as unknown as React.MouseEvent);

  it("opens the editor on a plain click", () => {
    const el = note();
    const { result, openEditor } = setup();
    click(el("text"), result.current.handleMemoContentClick);
    expect(openEditor).toHaveBeenCalledOnce();
  });

  it("opens the image preview for an image, not the editor", () => {
    const el = note();
    const { result, openEditor, openPreview } = setup();
    click(el("image"), result.current.handleMemoContentClick);
    expect(openPreview).toHaveBeenCalledWith("x.png");
    expect(openEditor).not.toHaveBeenCalled();
  });

  it("does nothing on links, tags and checkboxes", () => {
    const el = note();
    const { result, openEditor } = setup();
    for (const id of ["link", "tag", "check", "copy"]) click(el(id), result.current.handleMemoContentClick);
    expect(openEditor).not.toHaveBeenCalled();
  });

  it("never opens the editor for a note you cannot edit", () => {
    const el = note();
    const { result, openEditor } = setup(true);
    click(el("text"), result.current.handleMemoContentClick);
    expect(openEditor).not.toHaveBeenCalled();
  });

  it("keeps double-click editing working when the instance enables it", () => {
    settings.enableDoubleClickEdit = true;
    const { result, openEditor } = setup();
    const preventDefault = vi.fn();
    result.current.handleMemoContentDoubleClick({ preventDefault } as unknown as React.MouseEvent);
    expect(openEditor).toHaveBeenCalledOnce();
    expect(preventDefault).toHaveBeenCalled();
  });
});

describe("click after dragging a card", () => {
  const Card = ({ onArchive }: { onArchive: () => Promise<boolean> }) => {
    const ref = { current: null as HTMLElement | null };
    const handlers = useDragToArchive({ cardRef: ref, enabled: true, onArchive });
    return (
      <article ref={(el) => void (ref.current = el)} data-testid="card" {...handlers}>
        <p id="drag-text">note text</p>
      </article>
    );
  };

  it("does not treat the release of a drag as a click that opens the editor", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    render(<Card onArchive={async () => false} />);
    const text = screen.getByText("note text");
    fireEvent.pointerDown(text, { pointerId: 1, isPrimary: true, button: 0, pointerType: "mouse", clientX: 400, clientY: 50 });
    fireEvent.pointerMove(text, { pointerId: 1, isPrimary: true, clientX: 380, clientY: 50 });
    await act(async () => {
      fireEvent.pointerUp(text, { pointerId: 1, isPrimary: true, clientX: 380, clientY: 50 });
    });

    expect(isPlainContentClick(mouse(text))).toBe(false);
    vi.setSystemTime(Date.now() + 1000);
    expect(isPlainContentClick(mouse(text))).toBe(true);
  });
});
