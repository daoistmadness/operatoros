export const AUTH_SESSION_CHANNEL_NAME = "operatoros:auth-session";
export const AUTH_SESSION_CHANGED_TYPE = "auth-session-changed";
export const AUTH_AUTHORIZATION_CHANGED_TYPE = "auth-authorization-changed";

interface AuthSyncMessage {
  type: typeof AUTH_SESSION_CHANGED_TYPE | typeof AUTH_AUTHORIZATION_CHANGED_TYPE;
  senderId: string;
}

export interface AuthSessionSync {
  notify: () => void;
  notifyAuthorizationChange: () => void;
  subscribe: (listener: (change: "session" | "authorization") => void) => () => void;
}

function createSenderId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    // Fall through to a non-sensitive random identifier.
  }
  return `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function createChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === "undefined") return null;
  try {
    return new BroadcastChannel(AUTH_SESSION_CHANNEL_NAME);
  } catch {
    return null;
  }
}

function isAuthSyncMessage(value: unknown): value is AuthSyncMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as Record<string, unknown>;
  return (message.type === AUTH_SESSION_CHANGED_TYPE || message.type === AUTH_AUTHORIZATION_CHANGED_TYPE) && typeof message.senderId === "string";
}

export function createAuthSessionSync(): AuthSessionSync {
  const senderId = createSenderId();
  let channel: BroadcastChannel | null = null;
  let listener: ((change: "session" | "authorization") => void) | null = null;

  const handleMessage = (event: MessageEvent<unknown>) => {
    const message = event.data;
    if (!isAuthSyncMessage(message) || message.senderId === senderId) return;
    listener?.(message.type === AUTH_SESSION_CHANGED_TYPE ? "session" : "authorization");
  };

  const ensureChannel = () => {
    if (channel) return channel;
    channel = createChannel();
    channel?.addEventListener("message", handleMessage);
    return channel;
  };

  const notify = (type: AuthSyncMessage["type"]) => {
    const target = ensureChannel();
    if (!target) return;
    try {
      target.postMessage({ type, senderId } satisfies AuthSyncMessage);
    } catch {
      // A closed or unavailable channel must not affect the local session change.
    }
  };

  return {
    notify: () => notify(AUTH_SESSION_CHANGED_TYPE),
    notifyAuthorizationChange: () => notify(AUTH_AUTHORIZATION_CHANGED_TYPE),
    subscribe(next) {
      listener = next;
      const target = ensureChannel();
      if (!target) {
        return () => {
          if (listener === next) listener = null;
        };
      }
      return () => {
        if (listener === next) listener = null;
        target.removeEventListener("message", handleMessage);
        target.close();
        if (channel === target) channel = null;
      };
    },
  };
}
