import { redirect } from "next/navigation";
import { getAuthSession } from "@/lib/auth";
import { CoordinationPortal } from "@/components/coordination/portal-app";
import "@/components/coordination/portal.css";

export default async function ConnectPage() {
  const session = await getAuthSession();
  if (!session) redirect("/login");
  return <CoordinationPortal initialSession={session.user} />;
}
