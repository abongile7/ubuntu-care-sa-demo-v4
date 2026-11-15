import { redirect } from "next/navigation";
import { getAuthSession } from "@/lib/auth";
import { CareJourney } from "@/components/care-journey";
import "./journey.css";

export default async function JourneyPage() {
  const session = await getAuthSession();
  if (!session) redirect("/login");
  if (session.user.role === "referring_doctor") redirect("/connect");
  return <CareJourney initialSession={session.user} />;
}
