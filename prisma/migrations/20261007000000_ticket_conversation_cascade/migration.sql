-- a ticket goes with its conversation
ALTER TABLE "Ticket" DROP CONSTRAINT "Ticket_conversationId_fkey";
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
