import { redirect } from "next/navigation";
import { getAuthSession } from "@/lib/auth";
import PaperlessWorkspace from "@/components/paperless-workspace";
import "../remote/remote.css";
export default async function Page(){
  const session=await getAuthSession();
  if(!session)redirect("/login");
  if(!["patient","doctor","admin","nurse","billing"].includes(session.user.role))redirect("/journey");
  return <PaperlessWorkspace user={session.user}/>;
}
