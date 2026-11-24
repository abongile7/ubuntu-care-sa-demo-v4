import {redirect} from "next/navigation";
import {getAuthSession} from "@/lib/auth";
import OperationsBoard from "@/components/operations-board";
import "../remote/remote.css";
export default async function Page(){const s=await getAuthSession();if(!s)redirect("/login");if(!["admin","nurse"].includes(s.user.role))redirect("/sandbox");return <OperationsBoard admin={s.user.role==="admin"}/>;}
