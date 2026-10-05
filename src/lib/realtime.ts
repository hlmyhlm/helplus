/**
 * Real-time Event System
 *
 * Server-Sent Events (SSE) based real-time updates.
 * Lighter than WebSocket, works with Next.js edge runtime,
 * and doesn't require socket.io dependency.
 */

import { logger } from "@/lib/logger";
import { companyIdOrFallback } from "@/lib/tenant/context";

// subscribers and events are per company, so one company never sees another's events.
// uses the fallback (not currentCompanyId) because inbound channel flows (sms, telegram,
// phone, whatsapp, email) still call chat()/emitNewMessage outside any company context.
// Task 5 gives those flows a company, after which this goes back to currentCompanyId().
function companyChannel(channel: string): string {
  return `${companyIdOrFallback()}:${channel}`;
}

export type EventType =
  | "message:new"
  | "message:updated"
  | "conversation:new"
  | "conversation:updated"
  | "conversation:assigned"
  | "ticket:new"
  | "ticket:updated"
  | "typing:start"
  | "typing:stop"
  | "agent:online"
  | "agent:offline"
  | "notification";

interface EventPayload {
  type: EventType;
  data: Record<string, unknown>;
  timestamp: string;
  conversationId?: string;
}

type EventCallback = (event: EventPayload) => void;

// In-memory subscriber registry
const subscribers = new Map<string, Set<EventCallback>>();

/**
 * Subscribe to real-time events.
 * Returns an unsubscribe function.
 */
export function subscribe(
  channel: string,
  callback: EventCallback
): () => void {
  const key = companyChannel(channel);
  if (!subscribers.has(key)) {
    subscribers.set(key, new Set());
  }
  subscribers.get(key)!.add(callback);

  return () => {
    const subs = subscribers.get(key);
    if (subs) {
      subs.delete(callback);
      if (subs.size === 0) subscribers.delete(key);
    }
  };
}

/**
 * Publish an event to all subscribers on a channel.
 */
export function publish(channel: string, event: Omit<EventPayload, "timestamp">): void {
  const payload: EventPayload = {
    ...event,
    timestamp: new Date().toISOString(),
  };

  const subs = subscribers.get(companyChannel(channel));
  if (subs) {
    for (const callback of subs) {
      try {
        callback(payload);
      } catch (error) {
        logger.error("SSE subscriber callback error", error);
      }
    }
  }

  // Also publish to global channel
  if (channel !== "global") {
    const globalSubs = subscribers.get(companyChannel("global"));
    if (globalSubs) {
      for (const callback of globalSubs) {
        try {
          callback(payload);
        } catch (error) {
          logger.error("SSE global subscriber callback error", error);
        }
      }
    }
  }
}

/**
 * Helper: Emit a new message event.
 */
export function emitNewMessage(
  conversationId: string,
  message: { id: string; role: string; content: string }
): void {
  publish(`conversation:${conversationId}`, {
    type: "message:new",
    conversationId,
    data: message,
  });
  publish("global", {
    type: "message:new",
    conversationId,
    data: { conversationId, messageId: message.id, role: message.role },
  });
}

/**
 * Helper: Emit typing indicator.
 */
export function emitTyping(
  conversationId: string,
  userName: string,
  isTyping: boolean
): void {
  publish(`conversation:${conversationId}`, {
    type: isTyping ? "typing:start" : "typing:stop",
    conversationId,
    data: { userName },
  });
}

/**
 * Helper: Emit conversation update.
 */
export function emitConversationUpdate(
  conversationId: string,
  changes: Record<string, unknown>
): void {
  publish("global", {
    type: "conversation:updated",
    conversationId,
    data: changes,
  });
}

/**
 * Get subscriber count for monitoring.
 */
export function getSubscriberCount(): number {
  let count = 0;
  for (const subs of subscribers.values()) {
    count += subs.size;
  }
  return count;
}
