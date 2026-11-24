import { redirect } from "next/navigation";
import { getAuthSession } from "@/lib/auth";
import IntegrationLab from "@/components/integration-lab";
import "../remote/remote.css";
export default async function Page(){const s=await getAuthSession();if(!s)redirect("/login");if(!["admin","billing","doctor","nurse","paramedic"].includes(s.user.role))redirect("/sandbox");return <IntegrationLab/>;}
