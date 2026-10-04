import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_SETTINGS,
  defaultComputerName,
  loadSettings,
  normalizeServerUrl,
  normalizeTag,
  originPattern,
  sanitizeSettings,
  saveSettings,
  validateSettings,
  withDefaults,
} from "../../src/settings/settings.js";

describe("normalizeServerUrl", () => {
  it("adds https, drops trailing slashes and keeps a sub-path", () => {
    assert.equal(normalizeServerUrl("memos.example.com"), "https://memos.example.com");
    assert.equal(normalizeServerUrl("  https://memos.example.com/  "), "https://memos.example.com");
    assert.equal(normalizeServerUrl("http://192.168.1.5:5230///"), "http://192.168.1.5:5230");
    assert.equal(normalizeServerUrl("https://example.com/memos/"), "https://example.com/memos");
  });

  it("rejects empty input and non-http schemes", () => {
    for (const input of ["", "   ", undefined, "ftp://example.com", "javascript:alert(1)", "http://"]) {
      assert.equal(normalizeServerUrl(input), "", String(input));
    }
  });
});

describe("originPattern", () => {
  it("is the origin the browser must grant access to", () => {
    assert.equal(originPattern("https://example.com/memos"), "https://example.com/*");
    assert.equal(originPattern("http://localhost:5230"), "http://localhost:5230/*");
    assert.equal(originPattern(""), "");
  });
});

describe("normalizeTag", () => {
  it("makes a safe tag without the #", () => {
    assert.equal(normalizeTag("#Web Clip"), "Web-Clip");
    assert.equal(normalizeTag("inbox/web"), "inbox/web");
    assert.equal(normalizeTag("//a//b//"), "a/b");
    assert.equal(normalizeTag("bad!chars?"), "badchars");
    assert.equal(normalizeTag("   "), "");
  });
});

describe("defaultComputerName", () => {
  it("suggests a name from the platform, or nothing when unknown", () => {
    assert.equal(defaultComputerName("Windows"), "Windows computer");
    assert.equal(defaultComputerName("macOS"), "Mac computer");
    assert.equal(defaultComputerName("Plan9"), "");
  });
});

describe("withDefaults and sanitizeSettings", () => {
  it("fills missing values and ignores wrong types", () => {
    assert.deepEqual(withDefaults(undefined), DEFAULT_SETTINGS);
    assert.equal(withDefaults({ token: 5 }).token, "");
    assert.equal(withDefaults({ visibility: "SPACE" }).visibility, "PRIVATE");
  });

  it("cleans every field", () => {
    assert.deepEqual(
      sanitizeSettings({ serverUrl: "memos.example.com/", token: "  memos_pat_x ", computerName: " Desk ", tag: "#Read Later", visibility: "PUBLIC" }),
      { serverUrl: "https://memos.example.com", token: "memos_pat_x", computerName: "Desk", tag: "Read-Later", visibility: "PUBLIC" },
    );
  });
});

describe("validateSettings", () => {
  it("lists what is missing, server first", () => {
    assert.equal(validateSettings(DEFAULT_SETTINGS).length, 3);
    assert.match(validateSettings(DEFAULT_SETTINGS)[0], /server/i);
    assert.deepEqual(validateSettings({ serverUrl: "https://a", token: "t", computerName: "c" }), []);
  });
});

describe("storage", () => {
  const memoryStorage = () => {
    const data = {};
    return { data, get: async (keys) => Object.fromEntries(keys.filter((k) => k in data).map((k) => [k, data[k]])), set: async (items) => Object.assign(data, items) };
  };

  it("round-trips sanitized settings", async () => {
    const storage = memoryStorage();
    const saved = await saveSettings({ serverUrl: "memos.example.com", token: "t", computerName: "Desk", tag: "x", visibility: "PRIVATE" }, storage);
    assert.equal(storage.data.serverUrl, "https://memos.example.com");
    assert.deepEqual(await loadSettings(storage), saved);
  });

  it("loads defaults from empty storage", async () => {
    assert.deepEqual(await loadSettings(memoryStorage()), DEFAULT_SETTINGS);
  });
});
