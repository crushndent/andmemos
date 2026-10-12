import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildMemoContent, formatSavedAt, isSavableUrl } from "../../src/clip/memo.js";

const savedAt = new Date(2026, 9, 4, 13, 5); // local time: 4 Oct 2026, 13:05

describe("formatSavedAt", () => {
  it("formats local time with zero padding", () => {
    assert.equal(formatSavedAt(new Date(2026, 0, 2, 3, 4)), "2026-01-02 03:04");
    assert.equal(formatSavedAt(savedAt), "2026-10-04 13:05");
  });
});

describe("isSavableUrl", () => {
  it("accepts only http and https pages", () => {
    assert.equal(isSavableUrl("https://example.com/a"), true);
    assert.equal(isSavableUrl("http://localhost:3000"), true);
    for (const url of ["chrome://extensions", "file:///etc/passwd", "javascript:alert(1)", "about:blank", "", undefined]) {
      assert.equal(isSavableUrl(url), false, String(url));
    }
  });
});

describe("buildMemoContent", () => {
  const base = { title: "Example Domain", url: "https://example.com/", savedAt, computerName: "Work laptop", tag: "web-clip" };

  it("links the page and records the computer, the time and the tag", () => {
    assert.equal(
      buildMemoContent(base),
      "[Example Domain](https://example.com/)\n\nSaved from **Work laptop** on 2026-10-04 13:05\n#web-clip",
    );
  });

  it("omits the tag line when no tag is configured", () => {
    assert.equal(buildMemoContent({ ...base, tag: "" }), "[Example Domain](https://example.com/)\n\nSaved from **Work laptop** on 2026-10-04 13:05");
  });

  it("includes your note between the link and the footer", () => {
    const content = buildMemoContent({ ...base, note: "  read later  " });
    assert.equal(content.split("\n\n")[1], "read later");
  });

  it("quotes selected text, line by line, before the note", () => {
    const content = buildMemoContent({ ...base, selection: "first\n\nsecond", note: "why" });
    const blocks = content.split("\n\n");
    assert.equal(blocks[0], "[Example Domain](https://example.com/)");
    // A blank line inside a quote stays inside it, so the blocks are split on the quote's own lines.
    assert.ok(content.includes("> first\n>\n> second\n\nwhy\n\nSaved from"), content);
  });

  it("escapes brackets and collapses whitespace in the title", () => {
    const content = buildMemoContent({ ...base, title: "  [Draft]\n  notes \\ more  " });
    assert.ok(content.startsWith("[\\[Draft\\] notes \\\\ more](https://example.com/)"), content);
  });

  it("falls back to the URL when the page has no title", () => {
    assert.ok(buildMemoContent({ ...base, title: "" }).startsWith("[https://example.com/](https://example.com/)"));
  });

  it("keeps parentheses and spaces in the URL from breaking the link", () => {
    const content = buildMemoContent({ ...base, url: "https://en.wikipedia.org/wiki/Foo_(bar) baz" });
    assert.ok(content.includes("(https://en.wikipedia.org/wiki/Foo_%28bar%29%20baz)"), content);
  });
});
