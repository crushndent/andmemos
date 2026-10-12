import { DirectionProvider } from "@base-ui/react/direction-provider";
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ColumnGrid from "@/components/ColumnGrid";

// jsdom has no layout engine (offsetHeight/clientWidth are 0) and no ResizeObserver,
// both of which ColumnGrid guards for — so these assert render structure, not positioning.
interface Item {
  id: string;
}

const item = (id: string): Item => ({ id });
const getKey = (i: Item) => i.id;

describe("<ColumnGrid>", () => {
  it("renders one card per item", () => {
    const { container } = render(
      <ColumnGrid items={[item("a"), item("b"), item("c")]} getKey={getKey} renderItem={(i) => <div data-testid="card">{i.id}</div>} />,
    );

    expect(container.querySelectorAll('[data-testid="card"]')).toHaveLength(3);
  });

  it("renders the leading node as the first tile, before the items", () => {
    const { container, getByTestId } = render(
      <ColumnGrid
        items={[item("a")]}
        getKey={getKey}
        renderItem={(i) => <div data-testid={`card-${i.id}`}>{i.id}</div>}
        leading={<div data-testid="composer" />}
      />,
    );

    expect(getByTestId("composer")).toBeInTheDocument();
    // The grid is the container's only child; its first wrapper holds the leading node.
    const grid = container.firstElementChild as HTMLElement;
    expect(grid.children[0].querySelector('[data-testid="composer"]')).not.toBeNull();
  });

  it("spans the header across the packed columns and starts every column below it", () => {
    // 532px fits two 260px columns with a 12px gap; every measured height is 100px.
    const clientWidth = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(532);
    const offsetHeight = vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(100);

    const { getByTestId } = render(
      <ColumnGrid
        items={[item("a"), item("b")]}
        getKey={getKey}
        renderItem={(i) => <div data-testid={`card-${i.id}`}>{i.id}</div>}
        header={<div data-testid="identity" />}
      />,
    );

    const header = getByTestId("identity").parentElement as HTMLElement;
    expect(header.style.width).toBe("532px");
    expect(header.style.left).toBe("0px");
    // Header height plus one grid gap: both columns begin on the same line beneath it.
    expect(getByTestId("card-a").parentElement?.style.transform).toContain("translate3d(0px, 112px");
    expect(getByTestId("card-b").parentElement?.style.transform).toContain("translate3d(272px, 112px");

    clientWidth.mockRestore();
    offsetHeight.mockRestore();
  });

  it("renders nothing for an empty list", () => {
    const { container } = render(<ColumnGrid items={[]} getKey={getKey} renderItem={() => <div data-testid="card" />} />);

    expect(container.querySelectorAll('[data-testid="card"]')).toHaveLength(0);
  });

  it("places the first packed column at inline start in RTL", () => {
    const clientWidth = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(532);
    const offsetHeight = vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(100);

    const { getByTestId } = render(
      <DirectionProvider direction="rtl">
        <ColumnGrid items={[item("a"), item("b")]} getKey={getKey} renderItem={(i) => <div data-testid={`card-${i.id}`}>{i.id}</div>} />
      </DirectionProvider>,
    );

    expect(getByTestId("card-a").parentElement?.style.transform).toContain("translate3d(272px");
    expect(getByTestId("card-b").parentElement?.style.transform).toContain("translate3d(0px");

    clientWidth.mockRestore();
    offsetHeight.mockRestore();
  });

  it("packs a section break: separator below the tallest column, then both columns restart beneath it", () => {
    const clientWidth = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(532);
    const offsetHeight = vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(100);

    const { getByTestId } = render(
      <ColumnGrid
        items={[item("p1"), item("p2"), item("p3"), item("n1"), item("n2")]}
        getKey={getKey}
        renderItem={(i) => <div data-testid={`card-${i.id}`}>{i.id}</div>}
        sectionBreakKey="n1"
        separator={<div data-testid="sep" />}
      />,
    );

    const at = (id: string) => getByTestId(`card-${id}`).parentElement?.style.transform;
    // Pinned section: p1 and p2 fill the two columns, p3 stacks under p1 (column height 212).
    expect(at("p1")).toContain("translate3d(0px, 0px");
    expect(at("p2")).toContain("translate3d(272px, 0px");
    expect(at("p3")).toContain("translate3d(0px, 112px");
    // The separator spans the packed width just under the tallest pinned column (112 + 100 + 12 gap).
    const separator = getByTestId("sep").parentElement as HTMLElement;
    expect(separator.style.width).toBe("532px");
    expect(separator.style.top).toBe("224px");
    // Unpinned notes start beneath it in both columns, never beside the pinned ones.
    expect(at("n1")).toContain("translate3d(0px, 336px");
    expect(at("n2")).toContain("translate3d(272px, 336px");

    clientWidth.mockRestore();
    offsetHeight.mockRestore();
  });

  it("draws no separator when no section break key is given", () => {
    const { queryByTestId } = render(
      <ColumnGrid items={[item("a")]} getKey={getKey} renderItem={(i) => <div>{i.id}</div>} separator={<div data-testid="sep" />} />,
    );

    expect(queryByTestId("sep")).toBeNull();
  });
});
