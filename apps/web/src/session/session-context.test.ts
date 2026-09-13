import assert from "node:assert/strict";
import { test } from "node:test";
import {
  clearSessionKeyedState,
  handleSessionEnding,
  reconcileOnReconnect,
  SESSION_KEYED_PREFIXES,
} from "./session-context.ts";
import type { ClientSessionContext, ClientStorage, SessionEndHandlers } from "./session-context.ts";

function memoryStorage(initial: Record<string, string> = {}): ClientStorage {
  const map = new Map(Object.entries(initial));
  return {
    keys: () => [...map.keys()],
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

function handlers() {
  const calls: string[] = [];
  const h: SessionEndHandlers = {
    stopSubscriptions: () => calls.push("stopSubscriptions"),
    clearQueuedMutations: () => calls.push("clearQueuedMutations"),
  };
  return { h, calls };
}

void test("§7: clearSessionKeyedState removes every registered prefix and nothing else", () => {
  const storage = memoryStorage({
    "cobudget.session.current": "x",
    "cobudget.identifier.lastSpace": "y",
    "cobudget.draft.budget-123": "z",
    "cobudget.preview.schedule-9": "w",
    "cobudget.binding.plaid-1": "v",
    "unrelated.theme": "dark",
  });
  const cleared = clearSessionKeyedState(storage);
  assert.equal(cleared, 5);
  assert.deepEqual(storage.keys(), ["unrelated.theme"]);
});

void test("SESSION_KEYED_PREFIXES covers drafts, previews, bindings, identifiers, and the session cache itself", () => {
  assert.deepEqual(
    [...SESSION_KEYED_PREFIXES].sort(),
    ["cobudget.binding.", "cobudget.draft.", "cobudget.identifier.", "cobudget.preview.", "cobudget.session."].sort(),
  );
});

for (const cause of ["logout", "recovery_completed", "account_switch", "access_loss"] as const) {
  void test(`§7 trigger "${cause}": stops subscriptions and clears queued mutations before storage`, () => {
    const storage = memoryStorage({ "cobudget.draft.b1": "1" });
    const { h, calls } = handlers();
    const cleared = handleSessionEnding(cause, storage, h);
    assert.equal(cleared, 1);
    assert.deepEqual(calls, ["stopSubscriptions", "clearQueuedMutations"], "subscriptions/mutations must stop before storage is cleared");
    assert.deepEqual(storage.keys(), []);
  });
}

void test("CT-191-016: reconnect with a missing server context clears before any resume", async () => {
  const storage = memoryStorage({ "cobudget.session.current": "stale" });
  const { h, calls } = handlers();
  const stored: ClientSessionContext = { sessionRef: "ref-1", sessionVersion: 3 };
  const result = await reconcileOnReconnect(async () => undefined, stored, storage, h);
  assert.equal(result.cleared, true);
  assert.equal(result.serverContext, undefined);
  assert.deepEqual(calls, ["stopSubscriptions", "clearQueuedMutations"]);
  assert.deepEqual(storage.keys(), []);
});

void test("CT-191-016: reconnect with a changed sessionVersion (denied/rotated) clears", async () => {
  const storage = memoryStorage({ "cobudget.draft.b1": "1" });
  const { h } = handlers();
  const stored: ClientSessionContext = { sessionRef: "ref-1", sessionVersion: 3 };
  const server: ClientSessionContext = { sessionRef: "ref-1", sessionVersion: 4 };
  const result = await reconcileOnReconnect(async () => server, stored, storage, h);
  assert.equal(result.cleared, true);
  assert.deepEqual(storage.keys(), []);
});

void test("CT-191-016: reconnect with a changed sessionRef clears", async () => {
  const storage = memoryStorage({ "cobudget.draft.b1": "1" });
  const { h } = handlers();
  const stored: ClientSessionContext = { sessionRef: "ref-1", sessionVersion: 3 };
  const server: ClientSessionContext = { sessionRef: "ref-2", sessionVersion: 3 };
  const result = await reconcileOnReconnect(async () => server, stored, storage, h);
  assert.equal(result.cleared, true);
});

void test("CT-191-016 positive control: reconnect with matching context does not clear or stop anything", async () => {
  const storage = memoryStorage({ "cobudget.draft.b1": "1" });
  const { h, calls } = handlers();
  const stored: ClientSessionContext = { sessionRef: "ref-1", sessionVersion: 3 };
  const result = await reconcileOnReconnect(async () => stored, stored, storage, h);
  assert.equal(result.cleared, false);
  assert.deepEqual(calls, []);
  assert.deepEqual(storage.keys(), ["cobudget.draft.b1"]);
});

void test("CT-191-016: a fetch failure fails closed (treated as denied, never as unchanged)", async () => {
  const storage = memoryStorage({ "cobudget.draft.b1": "1" });
  const { h, calls } = handlers();
  const stored: ClientSessionContext = { sessionRef: "ref-1", sessionVersion: 3 };
  const result = await reconcileOnReconnect(
    async () => {
      throw new Error("network error");
    },
    stored,
    storage,
    h,
  );
  assert.equal(result.cleared, true);
  assert.deepEqual(calls, ["stopSubscriptions", "clearQueuedMutations"]);
});

void test("CT-191-016: no stored client context at all (first load) is treated as changed, not as trivially matching", async () => {
  const storage = memoryStorage();
  const { h } = handlers();
  const server: ClientSessionContext = { sessionRef: "ref-1", sessionVersion: 1 };
  const result = await reconcileOnReconnect(async () => server, undefined, storage, h);
  assert.equal(result.cleared, true);
});
