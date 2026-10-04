import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ApiError, createMemo, testConnection } from "../../src/server/api.js";

const settings = { serverUrl: "https://memos.example.com/base", token: "memos_pat_abc" };
const reply = (status, body) => async () => ({ ok: status >= 200 && status < 300, status, json: async () => body });

describe("createMemo", () => {
  it("sends a bearer-authenticated JSON POST under the server path", async () => {
    let seen;
    const fetchImpl = async (url, init) => {
      seen = { url, init };
      return { ok: true, status: 200, json: async () => ({ name: "memos/1" }) };
    };
    const memo = await createMemo(settings, { content: "hi", visibility: "PRIVATE" }, fetchImpl);

    assert.equal(memo.name, "memos/1");
    assert.equal(seen.url, "https://memos.example.com/base/api/v1/memos");
    assert.equal(seen.init.method, "POST");
    assert.equal(seen.init.headers.Authorization, "Bearer memos_pat_abc");
    assert.equal(seen.init.headers["Content-Type"], "application/json");
    assert.deepEqual(JSON.parse(seen.init.body), { content: "hi", visibility: "PRIVATE" });
  });

  it("explains a rejected token", async () => {
    for (const status of [401, 403]) {
      await assert.rejects(createMemo(settings, { content: "x" }, reply(status, {})), (error) => {
        assert.ok(error instanceof ApiError);
        assert.match(error.message, /access token/i);
        assert.equal(error.status, status);
        return true;
      });
    }
  });

  it("surfaces the server's message for other errors", async () => {
    await assert.rejects(createMemo(settings, { content: "x" }, reply(400, { message: "content too long" })), /content too long/);
  });

  it("falls back to the status when the body is not JSON", async () => {
    const fetchImpl = async () => ({ ok: false, status: 502, json: async () => { throw new Error("not json"); } });
    await assert.rejects(createMemo(settings, { content: "x" }, fetchImpl), /502/);
  });

  it("explains an unreachable server", async () => {
    const fetchImpl = async () => { throw new TypeError("Failed to fetch"); };
    await assert.rejects(createMemo(settings, { content: "x" }, fetchImpl), /Could not reach https:\/\/memos\.example\.com\/base/);
  });
});

describe("testConnection", () => {
  it("returns the signed-in username", async () => {
    let url;
    const fetchImpl = async (u) => {
      url = u;
      return { ok: true, status: 200, json: async () => ({ user: { username: "tom" } }) };
    };
    assert.equal(await testConnection(settings, fetchImpl), "tom");
    assert.equal(url, "https://memos.example.com/base/api/v1/auth/me");
  });
});
