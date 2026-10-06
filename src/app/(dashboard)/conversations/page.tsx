import { redirect } from "next/navigation";

// conversations live inside tickets now
export default function ConversationsPage() {
  redirect("/tickets");
}
