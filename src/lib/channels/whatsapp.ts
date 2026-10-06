import { Client, LocalAuth, Message } from "whatsapp-web.js";
import * as qrcode from "qrcode";
import { prisma } from "@/lib/prisma";
import { channelKey } from "@/lib/tenant/keys";
import { chat, createNewConversation } from "@/lib/ai/engine";
import { logger } from "@/lib/logger";
import { resolveCustomer } from "@/lib/customer-resolver";
import { currentCompanyId, runWithCompany } from "@/lib/tenant/context";
import { ChannelInUseError } from "@/lib/errors";
import { attachIncomingImage } from "@/lib/attachments/service";

// one whatsapp client per server for now; per-company clients come with the silent bot
let whatsappClient: Client | null = null;
let ownerCompanyId: string | null = null;
let currentQR: string | null = null;
let connectionStatus: "disconnected" | "qr_ready" | "connecting" | "connected" | "error" = "disconnected";
let statusMessage = "";

function ownedByAnother(companyId: string): boolean {
  return ownerCompanyId !== null && ownerCompanyId !== companyId;
}

// let go of a client that never got going, so another company can connect
function release(client: Client) {
  if (whatsappClient !== client) return;
  whatsappClient = null;
  ownerCompanyId = null;
  currentQR = null;
  client.destroy().catch(() => {});
}

export function getWhatsAppStatus() {
  if (ownedByAnother(currentCompanyId())) {
    return { status: "disconnected" as const, qr: null, message: "" };
  }
  return {
    status: connectionStatus,
    qr: currentQR,
    message: statusMessage,
  };
}

export async function initWhatsApp(): Promise<void> {
  // the client is started from a logged-in request; its events must run as that company
  const companyId = currentCompanyId();
  if (ownedByAnother(companyId)) throw new ChannelInUseError("WhatsApp");

  if (whatsappClient) {
    logger.info("[WhatsApp] Client already exists");
    return;
  }

  connectionStatus = "connecting";
  statusMessage = "Initializing WhatsApp client...";

  const client = new Client({
    // one saved session per company. default keeps the old unnamed session folder
    authStrategy: new LocalAuth({
      dataPath: ".wwebjs_auth",
      clientId: companyId === "default" ? undefined : companyId,
    }),
    puppeteer: {
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
      ],
    },
  });

  client.on("qr", async (qr: string) => {
    logger.info("[WhatsApp] QR code received");
    currentQR = await qrcode.toDataURL(qr);
    connectionStatus = "qr_ready";
    statusMessage = "Scan the QR code with WhatsApp on your phone";
  });

  client.on("ready", async () => {
    logger.info("[WhatsApp] Client is ready");
    currentQR = null;
    connectionStatus = "connected";
    statusMessage = "Connected to WhatsApp";

    await runWithCompany(companyId, async () => {
      await prisma.channel.upsert({
        where: channelKey("whatsapp"),
        update: { isActive: true, status: "connected" },
        create: { type: "whatsapp", isActive: true, status: "connected" },
      });
    });
  });

  client.on("authenticated", () => {
    logger.info("[WhatsApp] Authenticated");
    connectionStatus = "connecting";
    statusMessage = "Authenticated, loading chats...";
  });

  client.on("auth_failure", (message: string) => {
    logger.error(`[WhatsApp] Auth failure: ${message}`);
    connectionStatus = "error";
    statusMessage = `Authentication failed: ${message}`;
    release(client);
  });

  client.on("disconnected", async (reason: string) => {
    logger.info(`[WhatsApp] Disconnected: ${reason}`);
    connectionStatus = "disconnected";
    statusMessage = `Disconnected: ${reason}`;
    if (whatsappClient === client) {
      whatsappClient = null;
      ownerCompanyId = null;
    }

    await runWithCompany(companyId, async () => {
      await prisma.channel.upsert({
        where: channelKey("whatsapp"),
        update: { isActive: false, status: "disconnected" },
        create: { type: "whatsapp", isActive: false, status: "disconnected" },
      });
    });
  });

  client.on("message", async (message: Message) => {
    await runWithCompany(companyId, async () => {
      try {
        if (message.fromMe) return;

        const contact = await message.getContact();
        const customerName = contact.pushname || contact.name || "Unknown";
        const customerContact = message.from;

        // Resolve customer identity across channels
        const customerId = await resolveCustomer("whatsapp", customerContact, customerName);

        // Find or create conversation
        let conversation = await prisma.conversation.findFirst({
          where: {
            channel: "whatsapp",
            status: { in: ["active", "escalated"] },
            OR: [
              { customerId },
              { customerContact },
            ],
          },
        });

        if (!conversation) {
          conversation = await createNewConversation(
            "whatsapp",
            customerName,
            customerContact,
            customerId
          );
        }

        let messageContent = message.body;
        let incomingImage: Awaited<ReturnType<Message["downloadMedia"]>> | null = null;

        // Handle media messages
        if (message.hasMedia) {
          const media = await message.downloadMedia();
          if (media) {
            const mediaType = media.mimetype.split("/")[0];
            // keep the placeholder text so chat() still creates or updates the ticket
            messageContent = `[${mediaType} attachment: ${media.filename || "media"}] ${message.body || ""}`;

            if (mediaType === "audio") {
              messageContent = `[Voice message received] ${message.body || ""}`;
            }
            if (mediaType === "image") incomingImage = media;
          }
        }

        // Get AI response
        const aiResponse = await chat(conversation.id, messageContent);

        // the image goes on the ticket chat() just created or updated
        if (incomingImage) {
          try {
            await attachIncomingImage(
              conversation.id,
              Buffer.from(incomingImage.data, "base64"),
              incomingImage.filename || "whatsapp-image.jpg"
            );
          } catch (error) {
            logger.error("[WhatsApp] Failed to attach incoming image:", error);
          }
        }

        // Send response back via WhatsApp
        await message.reply(aiResponse);
      } catch (error) {
        logger.error("[WhatsApp] Failed to process message:", error);
      }
    });
  });

  whatsappClient = client;
  ownerCompanyId = companyId;
  try {
    await client.initialize();
  } catch (error) {
    connectionStatus = "error";
    statusMessage = "Could not start WhatsApp";
    release(client);
    throw error;
  }
}

export async function disconnectWhatsApp(): Promise<void> {
  if (ownedByAnother(currentCompanyId())) throw new ChannelInUseError("WhatsApp");
  if (whatsappClient) {
    await whatsappClient.destroy();
    whatsappClient = null;
    ownerCompanyId = null;
    currentQR = null;
    connectionStatus = "disconnected";
    statusMessage = "Disconnected";
  }
}

export async function sendWhatsAppMessage(
  to: string,
  message: string
): Promise<boolean> {
  if (!whatsappClient || connectionStatus !== "connected" || ownedByAnother(currentCompanyId())) {
    return false;
  }

  const chatId = to.includes("@c.us") ? to : `${to}@c.us`;
  await whatsappClient.sendMessage(chatId, message);
  return true;
}
