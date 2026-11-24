"use client";
import { useState, type FormEvent } from "react";
import "../remote/remote.css";
export default function Activate() {
  const [message,setMessage] = useState("");
  const [busy,setBusy] = useState(false);
  const [done,setDone] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const f = new FormData(e.currentTarget);
    if (f.get("password") !== f.get("confirm")) { setMessage("Passwords do not match."); return; }
    setBusy(true);
    try { const r = await fetch("/api/remote", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({action:"activate",code:f.get("code"),password:f.get("password")}) }); const d = await r.json(); if(!r.ok) throw Error(d.message); setDone(true); setMessage("Account activated. Sign in with the email provided to admissions."); } catch(e) { setMessage(e instanceof Error ? e.message : "Activation failed."); } finally {setBusy(false);}
  }
  return <main className="rc-shell"><section className="rc-card rc-activation"><span className="rc-kicker">UBUNTUCARE · PATIENT ACCESS</span><h1>Activate your account</h1><p>Use the one-time code issued by admissions. Fictional demonstration accounts only.</p>{!done && <form onSubmit={submit}><label>Invitation code<input name="code" required pattern="[a-f0-9]{48}" autoComplete="off"/></label><label>New password<input name="password" type="password" minLength={12} maxLength={72} required autoComplete="new-password"/></label><label>Confirm password<input name="confirm" type="password" required autoComplete="new-password"/></label><button disabled={busy}>Activate account</button></form>}<p role="status">{message}</p><a href="/login">Go to sign in →</a></section></main>;
}
