import { redirect } from "next/navigation";
import { getAuthSession } from "@/lib/auth";
import IntakeWorkspace from "@/components/intake-workspace";
import "../remote/remote.css";
export default async function Page(){
 const session=await getAuthSession();
 if(!session)redirect("/login");
 if(!["admin","doctor","nurse","paramedic"].includes(session.user.role))redirect("/journey");
 return <IntakeWorkspace user={session.user}/>;
}
