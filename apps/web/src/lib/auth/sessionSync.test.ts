import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AUTH_SESSION_CHANGED_TYPE,
  AUTH_SESSION_CHANNEL_NAME,
  createAuthSessionSync,
} from "./sessionSync";

async function flush() {
  await new Promise((resolve) => window.setTimeout(resolve, 0));
}

async function waitFor(assertion: () => void) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await flush();
    }
  }
  throw lastError;
}

describe("createAuthSessionSync", () => {
  const channels: BroadcastChannel[] = [];

  afterEach(() => {
    for (const channel of channels.splice(0)) channel.close();
  });

  function rawChannel() {
    const channel = new BroadcastChannel(AUTH_SESSION_CHANNEL_NAME);
    channels.push(channel);
    return channel;
  }

  it("broadcasts only a non-sensitive change signal", async () => {
    const sync = createAuthSessionSync();
    const unsubscribe = sync.subscribe(() => undefined);
    const channel = rawChannel();
    const received = new Promise<MessageEvent>((resolve) => {
      channel.addEventListener("message", resolve, { once: true });
    });

    try {
      sync.notify();
      const event = await received;

      expect(event.data).toEqual({
        type: AUTH_SESSION_CHANGED_TYPE,
        senderId: expect.any(String),
      });
      expect(Object.keys(event.data as Record<string, unknown>).sort()).toEqual(["senderId", "type"]);
      expect(JSON.stringify(event.data)).not.toMatch(/student|username|password|token|admin|checker/i);
    } finally {
      unsubscribe();
    }
  });

  it("notifies other instances and ignores its own signal", async () => {
    const first = createAuthSessionSync();
    const second = createAuthSessionSync();
    const firstListener = vi.fn();
    const secondListener = vi.fn();
    const unsubscribeFirst = first.subscribe(firstListener);
    const unsubscribeSecond = second.subscribe(secondListener);

    try {
      first.notify();
      await waitFor(() => expect(secondListener).toHaveBeenCalledTimes(1));
      expect(firstListener).not.toHaveBeenCalled();

      second.notify();
      await waitFor(() => expect(firstListener).toHaveBeenCalledTimes(1));
      expect(secondListener).toHaveBeenCalledTimes(1);
    } finally {
      unsubscribeFirst();
      unsubscribeSecond();
    }
  });

  it("ignores malformed messages", async () => {
    const sync = createAuthSessionSync();
    const listener = vi.fn();
    const unsubscribe = sync.subscribe(listener);
    const channel = rawChannel();

    try {
      channel.postMessage("auth-session-changed");
      channel.postMessage({ type: "some-other-event", senderId: "other-tab" });
      channel.postMessage({ type: AUTH_SESSION_CHANGED_TYPE, senderId: 42 });
      await flush();
      await flush();
      expect(listener).not.toHaveBeenCalled();
    } finally {
      unsubscribe();
    }
  });

  it("is a no-op when BroadcastChannel is unavailable", () => {
    const saved = globalThis.BroadcastChannel;
    delete (globalThis as { BroadcastChannel?: typeof BroadcastChannel }).BroadcastChannel;

    try {
      const sync = createAuthSessionSync();
      const listener = vi.fn();
      expect(() => sync.notify()).not.toThrow();
      const unsubscribe = sync.subscribe(listener);
      expect(() => sync.notify()).not.toThrow();
      expect(() => unsubscribe()).not.toThrow();
      expect(listener).not.toHaveBeenCalled();
    } finally {
      (globalThis as { BroadcastChannel?: typeof BroadcastChannel }).BroadcastChannel = saved;
    }
  });
});
