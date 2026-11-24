import { redirect } from "next/navigation";
import { getAuthSession } from "@/lib/auth";
import RemoteWorkspace from "@/components/remote-workspace";
import "./remote.css";
export default async function RemotePage() {
  const session = await getAuthSession();
  if (!session) redirect("/login");
  if (!["patient", "doctor", "admin"].includes(session.user.role)) redirect("/journey");
  return <RemoteWorkspace user={session.user} />;
}
