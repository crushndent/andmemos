import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";

const stored = { serverUrl: "https://memos.example.com", token: "memos_pat_t", computerName: "Desk", tag: "web-clip", visibility: "PRIVATE" };
const listeners = {};
const badge = [];
const created = [];
let opened = 0;
let storageValues = stored;

globalThis.chrome = {
  runtime: { onInstalled: { addListener: (fn) => (listeners.installed = fn) }, openOptionsPage: async () => { opened += 1; } },
  contextMenus: { create: (item) => created.push(item), onClicked: { addListener: (fn) => (listeners.menu = fn) } },
  commands: { onCommand: { addListener: (fn) => (listeners.command = fn) } },
  storage: { local: { get: async () => storageValues } },
  tabs: { query: async () => [{ id: 7, title: "Active page", url: "https://active.example.com/" }] },
  action: {
    setBadgeText: ({ text, tabId }) => badge.push({ text, tabId }),
    setBadgeBackgroundColor: () => {},
    setTitle: () => {},
  },
};

await import("../../src/background/background.js");

const posts = [];
const settle = () => new Promise((resolve) => setImmediate(resolve));

beforeEach(() => {
  posts.length = 0;
  badge.length = 0;
  opened = 0;
  storageValues = stored;
  globalThis.fetch = async (url, init) => {
    posts.push({ url, body: JSON.parse(init.body) });
    return { ok: true, status: 200, json: async () => ({ name: "memos/1" }) };
  };
  mock.timers.enable({ apis: ["setTimeout"] });
});

afterEach(() => mock.timers.reset());

describe("background", () => {
  it("adds one context-menu entry for pages, links and selections", () => {
    listeners.installed();
    assert.deepEqual(created, [{ id: "save-to-memos", title: "Save to Memos", contexts: ["page", "link", "selection"] }]);
  });

  it("saves the page from the right-click menu, quoting any selection, and flags success", async () => {
    listeners.menu({ menuItemId: "save-to-memos", pageUrl: "https://p.example.com/", selectionText: "quoted" }, { id: 3, title: "P" });
    await settle();

    assert.equal(posts.length, 1);
    assert.ok(posts[0].body.content.startsWith("[P](https://p.example.com/)\n\n> quoted"));
    assert.deepEqual(badge[0], { text: "✓", tabId: 3 });
  });

  it("saves a right-clicked link by its own URL, using the link text as title", async () => {
    listeners.menu({ menuItemId: "save-to-memos", linkUrl: "https://l.example.com/x", selectionText: "Link text", pageUrl: "https://p.example.com/" }, { id: 3, title: "P" });
    await settle();

    assert.ok(posts[0].body.content.startsWith("[Link text](https://l.example.com/x)"));
    assert.ok(!posts[0].body.content.includes("> "));
  });

  it("ignores other menus and pages that are not http(s)", async () => {
    listeners.menu({ menuItemId: "other", pageUrl: "https://p.example.com/" }, { id: 1 });
    listeners.menu({ menuItemId: "save-to-memos", pageUrl: "chrome://extensions" }, { id: 1, title: "x" });
    await settle();
    assert.equal(posts.length, 0);
  });

  it("saves the active tab on the keyboard shortcut", async () => {
    await listeners.command("save-page");
    await settle();
    assert.ok(posts[0].body.content.startsWith("[Active page](https://active.example.com/)"));
    await listeners.command("something-else");
    await settle();
    assert.equal(posts.length, 1);
  });

  it("flags a failure on the badge", async () => {
    globalThis.fetch = async () => ({ ok: false, status: 401, json: async () => ({}) });
    listeners.menu({ menuItemId: "save-to-memos", pageUrl: "https://p.example.com/" }, { id: 9, title: "P" });
    await settle();
    assert.deepEqual(badge[0], { text: "!", tabId: 9 });
  });

  it("opens the options instead of saving when setup is incomplete", async () => {
    storageValues = { ...stored, token: "" };
    listeners.menu({ menuItemId: "save-to-memos", pageUrl: "https://p.example.com/" }, { id: 1, title: "P" });
    await settle();
    assert.equal(opened, 1);
    assert.equal(posts.length, 0);
  });

  it("clears the badge after a few seconds", async () => {
    listeners.menu({ menuItemId: "save-to-memos", pageUrl: "https://p.example.com/" }, { id: 3, title: "P" });
    await settle();
    mock.timers.tick(5000);
    assert.deepEqual(badge.at(-1), { text: "", tabId: 3 });
  });
});
