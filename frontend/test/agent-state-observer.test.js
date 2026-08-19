import test from "node:test";
import assert from "node:assert/strict";
import { observeAgentState } from "../src/hooks/useAgentState.js";

test("taskbar Agent observer requests state only", async () => {
  const calls = [];
  const states = [];
  const agent = {
    getState: async () => {
      calls.push("getState");
      return { status: "ready" };
    },
    getMessages: async () => calls.push("getMessages"),
    prompt: async () => calls.push("prompt"),
    abort: async () => calls.push("abort"),
    newSession: async () => calls.push("newSession"),
  };
  const events = {
    subscribe(eventName) {
      calls.push(`subscribe:${eventName}`);
      return () => calls.push(`unsubscribe:${eventName}`);
    },
  };
  const observer = observeAgentState(
    agent,
    events,
    (state) => states.push(state),
    (error) => assert.fail(error),
  );

  await observer.ready;
  observer.dispose();

  assert.deepEqual(calls, [
    "subscribe:agent.stateChanged",
    "getState",
    "unsubscribe:agent.stateChanged",
  ]);
  assert.deepEqual(states, [{ status: "ready" }]);
});

test("live Agent state wins over an older initial snapshot", async () => {
  let publish;
  let resolveInitial;
  const states = [];
  const observer = observeAgentState(
    {
      getState: () => new Promise((resolve) => {
        resolveInitial = resolve;
      }),
    },
    {
      subscribe(_eventName, listener) {
        publish = listener;
        return () => {};
      },
    },
    (state) => states.push(state),
    (error) => assert.fail(error),
  );

  publish({ status: "running" });
  resolveInitial({ status: "ready" });
  await observer.ready;
  observer.dispose();

  assert.deepEqual(states, [{ status: "running" }]);
});
