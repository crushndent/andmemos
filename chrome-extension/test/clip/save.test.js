import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { savePage } from "../../src/clip/save.js";

const settings = {
  serverUrl: "https://memos.example.com",
  token: "memos_pat_abc",
  computerName: "Desk",
  tag: "web-clip",
  visibility: "PRIVATE",
};
const page = { title: "Hello", url: "https://example.com/" };
const now = new Date(2026, 9, 4, 13, 5);

const okFetch = (calls) => async (url, init) => {
  calls.push({ url, init });
  return { ok: true, status: 200, json: async () => ({ name: "memos/xyz" }) };
};

describe("savePage", () => {
  it("posts the note and returns a link to it", async () => {
    const calls = [];
    const result = await savePage({ settings, page, note: "n", now, fetchImpl: okFetch(calls) });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://memos.example.com/api/v1/memos");
    const body = JSON.parse(calls[0].init.body);
    assert.equal(body.visibility, "PRIVATE");
    assert.ok(body.content.includes("Saved from **Desk** on 2026-10-04 13:05"));
    assert.ok(body.content.endsWith("#web-clip"));
    assert.equal(result.url, "https://memos.example.com/memos/xyz");
  });

  it("refuses to save until the settings are complete", async () => {
    const calls = [];
    await assert.rejects(savePage({ settings: { ...settings, token: "" }, page, fetchImpl: okFetch(calls) }), /access token/i);
    await assert.rejects(savePage({ settings: { ...settings, computerName: "" }, page, fetchImpl: okFetch(calls) }), /name/i);
    assert.equal(calls.length, 0);
  });

  it("refuses pages that are not http or https", async () => {
    const calls = [];
    await assert.rejects(savePage({ settings, page: { title: "x", url: "chrome://settings" }, fetchImpl: okFetch(calls) }), /http/);
    assert.equal(calls.length, 0);
  });
});
