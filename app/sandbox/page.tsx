import { getAuthSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import SandboxHub from "@/components/sandbox-hub";
import "../remote/remote.css";
export default async function Page(){const session=await getAuthSession();if(!session)redirect("/login");return <SandboxHub user={session.user}/>;}
