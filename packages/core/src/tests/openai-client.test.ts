import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Models } from "openai/resources/models";
import { createOpenAIClientFactory, DEEPCODE_PLUS_BASE_URL, resolveOpenAIConnection } from "../common/openai-client";

test("resolveOpenAIConnection falls back to DeepCode Plus credentials", () => {
  const resolved = resolveOpenAIConnection(
    { baseURL: "https://configured.example.com" },
    "sk-aaaaaaaaaaaaaaaaaaaaaaaa"
  );

  assert.deepEqual(resolved, {
    apiKey: "sk-aaaaaaaaaaaaaaaaaaaaaaaa",
    baseURL: DEEPCODE_PLUS_BASE_URL,
    usingPlus: true,
  });
});

test("resolveOpenAIConnection prefers regular credentials", () => {
  const resolved = resolveOpenAIConnection(
    { apiKey: "sk-regular-test", baseURL: "https://configured.example.com" },
    "sk-aaaaaaaaaaaaaaaaaaaaaaaa"
  );

  assert.deepEqual(resolved, {
    apiKey: "sk-regular-test",
    baseURL: "https://configured.example.com",
    usingPlus: false,
  });
});

test("resolveOpenAIConnection preserves the configured base URL without credentials", () => {
  const resolved = resolveOpenAIConnection({ baseURL: "https://configured.example.com" });

  assert.deepEqual(resolved, {
    apiKey: undefined,
    baseURL: "https://configured.example.com",
    usingPlus: false,
  });
});

test("on mode retains PLUS routing after the existing models warmup fails", async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "deepcode-plus-warmup-"));
  const homeVariable = process.platform === "win32" ? "USERPROFILE" : "HOME";
  const originalHome = process.env[homeVariable];
  process.env[homeVariable] = home;
  fs.mkdirSync(path.join(home, ".deepcode-plus"));
  fs.writeFileSync(
    path.join(home, ".deepcode-plus", "settings.json"),
    JSON.stringify({
      subscriptionPlan: "on",
      env: { PLUS_API_KEY: "sk-bbbbbbbbbbbbbbbbbbbbbbbbbb" },
    })
  );
  // Stub the SDK warmup, so no request can reach the real PLUS service.
  const warmup = t.mock.method(Models.prototype, "list", () => Promise.reject(new Error("HTTP 403")));
  try {
    const factory = createOpenAIClientFactory(home);
    await factory.prepare!();
    const first = factory();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(warmup.mock.callCount(), 1);
    assert.equal(first.usingPlus, true);
    assert.equal(first.apiKey, "sk-bbbbbbbbbbbbbbbbbbbbbbbbbb");
    assert.equal(first.baseURL, "https://chat.deepcodeplus.com/plugin/openai");
    assert.equal(first.client?.baseURL, first.baseURL);
    assert.equal(factory().client, first.client);
    assert.equal(factory().usingPlus, true);
    assert.equal(warmup.mock.callCount(), 1, "cached client should not warm up again");
  } finally {
    if (originalHome === undefined) delete process.env[homeVariable];
    else process.env[homeVariable] = originalHome;
    fs.rmSync(home, { recursive: true, force: true });
  }
});
