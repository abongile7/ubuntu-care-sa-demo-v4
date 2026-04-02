import Link from "next/link";
import { redirect } from "next/navigation";
import { LoginPanel } from "@/components/login-panel";
import { getAuthSession } from "@/lib/auth";

export default async function LoginPage() {
  const session = await getAuthSession();

  if (session) {
    redirect("/portal");
  }

  return (
    <main className="auth-page">
      <div className="shell auth-shell">
        <div className="auth-topbar">
          <Link href="/" className="brand brand-simple">
            <span className="brand-mark">✚</span>
            <span>
              <strong>UbuntuCare</strong>
              <small>Back to landing page</small>
            </span>
          </Link>
        </div>
        <LoginPanel />
      </div>
    </main>
  );
}
