import assert from "node:assert/strict";
import { test } from "node:test";
import apiClient, { checkServiceHealth, getApiBaseUrl } from "../src/utils/api.ts";

test("API base ends in /api and health follows the WebSocket origin with the exact trailing-slash route", async (t) => {
  assert.equal(apiClient.defaults.baseURL, "/api");
  assert.equal(getApiBaseUrl("wss://cv.example:9443/api/v1/stream?token=discard"), "https://cv.example:9443/api");
  const previous = apiClient.defaults.adapter;
  t.after(() => { apiClient.defaults.adapter = previous; });
  apiClient.defaults.adapter = async (request) => {
    assert.equal(apiClient.getUri(request), "http://localhost:9000/api/health/");
    assert.equal(request.timeout, 3000);
    assert.ok(request.signal);
    return { data: { status: "ok" }, status: 200, statusText: "OK", headers: {}, config: request };
  };
  await checkServiceHealth("ws://localhost:9000/api/v1/stream", new AbortController().signal);
});

test("unhealthy payloads, HTTP failures, and cancelled health requests reject", async (t) => {
  const previous = apiClient.defaults.adapter;
  t.after(() => { apiClient.defaults.adapter = previous; });
  for (const data of [null, "ok", { status: "unavailable" }]) {
    apiClient.defaults.adapter = async (request) => ({ data, status: 200, statusText: "OK", headers: {}, config: request });
    await assert.rejects(checkServiceHealth("ws://localhost:8000/api/v1/stream", new AbortController().signal));
  }
  apiClient.defaults.adapter = async () => { throw new Error("HTTP failure"); };
  await assert.rejects(checkServiceHealth("ws://localhost:8000/api/v1/stream", new AbortController().signal));
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(checkServiceHealth("ws://localhost:8000/api/v1/stream", abort.signal));
});
