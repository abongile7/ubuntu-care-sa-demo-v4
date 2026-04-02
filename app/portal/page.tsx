import { redirect } from "next/navigation";
import { PortalApp } from "@/components/portal-app";
import { getAuthSession } from "@/lib/auth";

export default async function PortalPage() {
  const session = await getAuthSession();
  const user = session?.user;

  if (!user) {
    redirect("/login");
  }

  return (
    <main className="portal-page">
      <div className="shell portal-page-shell">
        <PortalApp initialSession={user} />
      </div>
    </main>
  );
}
