import { NextRequest, NextResponse } from "next/server";
import { chat, createNewConversation } from "@/lib/ai/engine";
import { logger } from "@/lib/logger";
import { withAuth } from "@/lib/tenant/with-auth";
import { loadConversationFor } from "@/lib/tickets/load";

export const POST = withAuth("conversations:create", async (request: NextRequest, auth) => {
  try {
    const body = await request.json();
    const { message, conversationId, channel, customerName, customerContact } = body;

    if (!message || typeof message !== "string" || !message.trim()) {
      return NextResponse.json({ error: "Message is required" }, { status: 400 });
    }

    if (message.length > 10000) {
      return NextResponse.json({ error: "Message exceeds maximum length of 10000 characters" }, { status: 400 });
    }

    if (conversationId && !(await loadConversationFor(auth, String(conversationId)))) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    let convId = conversationId;

    if (!convId) {
      const conversation = await createNewConversation(
        channel || "api",
        customerName || "API User",
        customerContact || ""
      );
      convId = conversation.id;
    }

    const response = await chat(convId, message.trim());

    return NextResponse.json({
      conversationId: convId,
      response,
    });
  } catch (error) {
    logger.error("Failed to process chat message:", error);
    return NextResponse.json(
      { error: "Failed to process message" },
      { status: 500 }
    );
  }
});
