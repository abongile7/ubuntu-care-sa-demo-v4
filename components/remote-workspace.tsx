"use client";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

type User = { id:string; name:string; role:string };
type Profile = { fullName:string; phone:string; medicalAidScheme:string; medicalAidPlan:string; nextOfKin:string; nextOfKinPhone:string; popiaConsent:boolean; consentTreatment:boolean };
type Doctor = { id:string; name:string; unit:string };
type Patient = { id:string; fullName:string; facilityFileNumber:string };
type Message = { id:string; authorId:string; authorName:string; body:string; createdAt:string };
type Consultation = { id:string; mode:string; reason:string; scheduledAt:string; status:string; offer:string; answer:string; patient:{fullName:string;popiaConsent:boolean;consentTreatment:boolean}; doctor:{name:string;unit:string}; messages:Message[] };
type Data = { profile?:Profile; doctors?:Doctor[]; patients?:Patient[]; consultations:Consultation[]; iceServers?:RTCIceServer[]; phone?:string };
const modes:Record<string,string> = { VIDEO:"Video consultation", AUDIO:"Internet voice call", PHONE:"Normal phone call", CHAT:"Chat consultation", IN_PERSON:"Hospital visit" };
const empty:Data = { consultations:[] };
function formObject(e:FormEvent<HTMLFormElement>) { return Object.fromEntries(new FormData(e.currentTarget)); }
async function post(action:string, fields:Record<string,unknown> = {}, url="/api/remote") {
  const res=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action,...fields})});
  const data=await res.json(); if(!res.ok || data.ok===false) throw Error(data.message || "Request failed."); return data;
}
function formatDate(s:string) { return new Date(s).toLocaleString("en-ZA",{timeZone:"Africa/Johannesburg",dateStyle:"medium",timeStyle:"short"}); }
function waitIce(pc:RTCPeerConnection) {
  return new Promise<void>((resolve,reject)=>{
    if(pc.iceGatheringState==="complete") {resolve();return;}
    const cleanup=()=>{clearTimeout(timer);pc.removeEventListener("icegatheringstatechange",change);};
    const change=()=>{if(pc.iceGatheringState==="complete"){cleanup();resolve();}};
    const timer=setTimeout(()=>{cleanup();reject(Error("Network discovery timed out. Check your connection and try again."));},20000);
    pc.addEventListener("icegatheringstatechange",change);
  });
}
export default function RemoteWorkspace({user}:{user:User}) {
  const [data,setData]=useState<Data>(empty), [selected,setSelected]=useState(""), [notice,setNotice]=useState(""), [busy,setBusy]=useState(false), [loaded,setLoaded]=useState(false), [invite,setInvite]=useState(""), [chat,setChat]=useState(""), [connection,setConnection]=useState("Not connected"), [muted,setMuted]=useState(false), [cameraOff,setCameraOff]=useState(false);
  const localVideo=useRef<HTMLVideoElement>(null), remoteVideo=useRef<HTMLVideoElement>(null);
  const peer=useRef<RTCPeerConnection|null>(null), stream=useRef<MediaStream|null>(null), activeId=useRef(""), applying=useRef(false), ownOffer=useRef(false), seenOffer=useRef(false), remoteAnswer=useRef(false), loading=useRef(false);
  const patient=user.role==="patient", doctor=user.role==="doctor", admin=user.role==="admin";
  const c=data.consultations.find(x=>x.id===selected);
  const permitted=!!c && c.status==="ACCEPTED" && c.patient.popiaConsent && c.patient.consentTreatment;
  const mediaMode=!!c && ["VIDEO","AUDIO"].includes(c.mode);
  const load=useCallback(async()=>{
    if(loading.current) return;
    loading.current=true;
    try {const res=await fetch("/api/remote",{cache:"no-store"});const d=await res.json();if(!res.ok)throw Error(d.message);setData(d);setLoaded(true);setSelected(old=>old || d.consultations?.[0]?.id || "");}catch(e){setNotice(e instanceof Error?e.message:"Unable to refresh.");}finally{loading.current=false;}
  },[]);
  useEffect(()=>{void load();const timer=setInterval(()=>void load(),1800);return()=>clearInterval(timer);},[load]);
  function closeLocal() {
    if(peer.current){peer.current.onconnectionstatechange=null;peer.current.ontrack=null;peer.current.close();peer.current=null;}
    stream.current?.getTracks().forEach(t=>t.stop());stream.current=null;activeId.current="";ownOffer.current=false;seenOffer.current=false;remoteAnswer.current=false;
    if(localVideo.current)localVideo.current.srcObject=null;if(remoteVideo.current)remoteVideo.current.srcObject=null;
    setConnection("Not connected");setMuted(false);setCameraOff(false);
  }
  useEffect(()=>()=>{peer.current?.close();stream.current?.getTracks().forEach(t=>t.stop());},[]);
  useEffect(()=>{
    if(!activeId.current || applying.current)return;
    if(!c || c.id!==activeId.current || !permitted){closeLocal();return;}
    if(c.offer)seenOffer.current=true;
    if(seenOffer.current && !c.offer){closeLocal();return;}
    if(patient && ownOffer.current && c.answer && !remoteAnswer.current && peer.current){
      remoteAnswer.current=true;
      void peer.current.setRemoteDescription({type:"answer",sdp:c.answer}).catch(()=>{setNotice("Unable to connect; end the call and try again.");closeLocal();});
    }
  },[c,permitted,patient]);
  async function run(action:string, fields:Record<string,unknown>={}, url?:string) {
    setBusy(true);setNotice("");
    try {const d=await post(action,fields,url);if(d.code)setInvite(d.code);if(d.id)setSelected(d.id);if(action==="registerPatient")setNotice("Patient registered. Choose their record below and issue an invitation.");else if(action==="onboard")setNotice("Onboarding details saved.");else if(action==="invite")setNotice("One-time code created. Share it privately with the fictional patient.");else if(action==="book")setNotice("Request sent to the selected doctor.");await load();return true;}
    catch(e){setNotice(e instanceof Error?e.message:"Action failed.");return false;}finally{setBusy(false);}
  }
  async function startCall() {
    if(!c || !permitted || !mediaMode || applying.current || peer.current)return;
    applying.current=true;setBusy(true);setNotice("");setConnection("Requesting device access…");
    try {
      if(!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw Error("Camera and microphone require HTTPS or localhost.");
      if(doctor && !c.offer)throw Error("Wait for the patient to start the call.");
      const local=await navigator.mediaDevices.getUserMedia({audio:true,video:c.mode==="VIDEO"});
      stream.current=local;if(localVideo.current)localVideo.current.srcObject=local;
      const pc=new RTCPeerConnection({iceServers:data.iceServers||[]});peer.current=pc;activeId.current=c.id;
      pc.onconnectionstatechange=()=>setConnection(pc.connectionState);
      pc.ontrack=e=>{if(remoteVideo.current){remoteVideo.current.srcObject=e.streams[0] || new MediaStream([e.track]);void remoteVideo.current.play().catch(()=>{});}};
      local.getTracks().forEach(track=>pc.addTrack(track,local));
      if(doctor){await pc.setRemoteDescription({type:"offer",sdp:c.offer});seenOffer.current=true;await pc.setLocalDescription(await pc.createAnswer());}
      else {ownOffer.current=true;await pc.setLocalDescription(await pc.createOffer());}
      await waitIce(pc);
      await post(doctor?"answer":"offer",{id:c.id,sdp:pc.localDescription?.sdp});
      setConnection("Waiting for connection…");await load();
    } catch(e) {closeLocal();setNotice(e instanceof Error?e.message:"Call could not start.");}
    finally{applying.current=false;setBusy(false);}
  }
  async function hangup() {if(!c)return;closeLocal();await run("hangup",{id:c.id});}
  function toggleTrack(kind:"audio"|"video"){const next=kind==="audio"?!muted:!cameraOff;stream.current?.getTracks().filter(t=>t.kind===kind).forEach(t=>t.enabled=!next);if(kind==="audio")setMuted(next);else setCameraOff(next);}
  async function select(id:string){if(activeId.current){setNotice("End the current call before switching consultations.");return;}setSelected(id);setChat("");}
  const profile=data.profile;
  return <main className="rc-shell">
    <header className="rc-header"><div><a className="rc-brand" href="/">✚ UbuntuCare <span>SA</span></a><div className="rc-kicker">PRIVATE HOSPITAL · CONNECTED CARE</div></div><nav><a href="/journey">Hospital journey</a><a href="/portal">Hospital workspace</a><a href="/login">Switch account</a></nav></header>
    <div className="rc-banner"><strong>Demonstration environment</strong> · Use fictional details only. Not an emergency or monitored service. For a medical emergency, contact local emergency services.</div>
    <section className="rc-hero"><div><span className="rc-kicker">{admin?"ADMISSIONS DESK":doctor?"CLINICIAN WORKSPACE":"PATIENT SERVICES"}</span><h1>{admin?"Patient onboarding":doctor?"Consultation centre":"Your care, connected."}</h1><p>{admin?"Register a patient and securely issue a one-time access code.":doctor?"Review requests, accept appointments and connect with your assigned patients.":"Complete your profile, request an appointment and connect with your doctor."}</p></div><div className="rc-user"><span className="rc-avatar">{user.name.slice(0,1)}</span><div><strong>{user.name}</strong><small>{user.role}</small></div></div></section>
    {notice&&<div className="rc-notice" role="status">{notice} <button className="rc-link" onClick={()=>setNotice("")}>Dismiss</button></div>}
    {!loaded&&<p role="status">Loading workspace…</p>}
    {admin&&loaded&&<div className="rc-columns">
      <section className="rc-card"><span className="rc-kicker">STEP 01</span><h2>Register a fictional patient</h2><form onSubmit={e=>{e.preventDefault();void run("registerPatient",formObject(e),"/api/journey");}}>
        <div className="rc-fields"><label>Full name<input name="fullName" required maxLength={160}/></label><label>Email<input name="email" type="email" required/></label><label>Date of birth<input name="dateOfBirth" type="date" required/></label><label>Fictional ID / passport<input name="saId" required maxLength={20}/></label><label>Contact number<input name="phone" required type="tel"/></label><label>Funding<input name="medicalAidScheme" defaultValue="Self-pay / cash patient" required/></label><label>Membership number (optional)<input name="medicalAidNumber"/></label></div><p className="rc-small">Consent is recorded by the patient after activation, not assumed by admissions.</p><button disabled={busy}>Register patient</button></form></section>
      <section className="rc-card"><span className="rc-kicker">STEP 02</span><h2>Issue account access</h2><p>Codes expire after 30 minutes and are single-use. Issuing a new code invalidates previous codes; activation replaces the account password.</p><form onSubmit={e=>{e.preventDefault();setInvite("");void run("invite",formObject(e));}}><label>Registered patient<select name="patientId" required><option value="">Select patient</option>{data.patients?.map(p=><option key={p.id} value={p.id}>{p.fullName} · {p.facilityFileNumber}</option>)}</select></label><button disabled={busy}>Generate invitation</button></form>{invite&&<div className="rc-invite"><strong>One-time activation code</strong><code>{invite}</code><button onClick={()=>{void navigator.clipboard.writeText(invite).then(()=>setNotice("Code copied.")).catch(()=>setNotice("Select the code and copy it manually."));}}>Copy code</button><a href="/activate" target="_blank" rel="noreferrer">Open activation page ↗</a></div>}</section>
    </div>}
    {patient&&profile&&<div className="rc-columns">
      <section className="rc-card"><span className="rc-kicker">01 · ONBOARDING</span><h2>Your details</h2><p className="rc-small">Identity and demographics are registered by admissions. Review contact and funding details below.</p><form key={profile.fullName} onSubmit={e=>{e.preventDefault();const f=formObject(e);void run("onboard",{...f,popiaConsent:f.popiaConsent==="on",consentTreatment:f.consentTreatment==="on"});}}>
        <div className="rc-fields"><label>Contact number<input name="phone" type="tel" defaultValue={profile.phone} required/></label><label>Medical aid / self-pay<input name="medicalAidScheme" defaultValue={profile.medicalAidScheme} required/></label><label>Plan<input name="medicalAidPlan" defaultValue={profile.medicalAidPlan}/></label><label>Emergency contact<input name="nextOfKin" defaultValue={profile.nextOfKin}/></label><label>Emergency contact number<input name="nextOfKinPhone" defaultValue={profile.nextOfKinPhone}/></label></div>
        <label className="rc-check"><input name="popiaConsent" type="checkbox" defaultChecked={profile.popiaConsent}/> I agree to the processing of my fictional demo information for this consultation.</label><label className="rc-check"><input name="consentTreatment" type="checkbox" defaultChecked={profile.consentTreatment}/> I consent to the demonstration consultation; I may withdraw consent.</label><button disabled={busy}>Save onboarding</button></form></section>
      <section className="rc-card"><span className="rc-kicker">02 · APPOINTMENTS</span><h2>Request a consultation</h2><form onSubmit={e=>{e.preventDefault();const f=formObject(e);const raw=String(f.scheduledAt);void run("book",{...f,scheduledAt:new Date(raw+"+02:00").toISOString()});}}>
        <label>Choose a doctor<select name="doctorId" required><option value="">Select clinician</option>{data.doctors?.map(d=><option key={d.id} value={d.id}>{d.name} · {d.unit}</option>)}</select></label><label>Consultation type<select name="mode">{Object.entries(modes).map(([k,v])=><option value={k} key={k}>{v}</option>)}</select></label><label>Preferred date and time (SAST)<input type="datetime-local" name="scheduledAt" required/></label><label>Reason for visit<textarea name="reason" required maxLength={500} rows={3} placeholder="Fictional reason for consultation"/></label><button disabled={busy||!profile.popiaConsent||!profile.consentTreatment}>Request appointment</button>{(!profile.popiaConsent||!profile.consentTreatment)&&<p className="rc-small">Save your consent choices before requesting a consultation.</p>}<p className="rc-small">Requests need doctor acceptance. This is not confirmed availability or a payment.</p></form></section>
    </div>}
    {!admin&&loaded&&<div className="rc-workspace">
      <section className="rc-card rc-list"><span className="rc-kicker">APPOINTMENTS</span><h2>{doctor?"Your patient requests":"Your consultations"}</h2>{!data.consultations.length&&<p>No consultations yet.</p>}{data.consultations.map(row=><button key={row.id} className={"rc-item "+(selected===row.id?"rc-selected":"")} onClick={()=>void select(row.id)}><strong>{patient?row.doctor.name:row.patient.fullName}</strong><span>{modes[row.mode]} · {formatDate(row.scheduledAt)}</span><small>{row.status}</small></button>)}</section>
      <section className="rc-card"><span className="rc-kicker">CONSULTATION ROOM</span>{!c?<p>Choose a consultation to view its details.</p>:<>
        <div className="rc-room-head"><div><h2>{patient?c.doctor.name:c.patient.fullName}</h2><p>{modes[c.mode]} · {formatDate(c.scheduledAt)} SAST</p></div><span className="rc-status">{c.status}</span></div><p>{c.reason}</p>
        <div className="rc-actions">{doctor&&c.status==="REQUESTED"&&<button disabled={busy} onClick={()=>void run("accept",{id:c.id})}>Accept request</button>}{["REQUESTED","ACCEPTED"].includes(c.status)&&<button className="rc-outline" disabled={busy} onClick={()=>{closeLocal();void run("cancel",{id:c.id});}}>Cancel</button>}{doctor&&permitted&&<button className="rc-outline" disabled={busy} onClick={()=>{closeLocal();void run("complete",{id:c.id});}}>Complete consultation</button>}</div>
        {permitted&&mediaMode&&<div className="rc-call"><div className="rc-video"><video ref={remoteVideo} autoPlay playsInline/><video ref={localVideo} className="rc-self" autoPlay playsInline muted/><span>{connection}</span></div><div className="rc-actions"><button disabled={busy||!!activeId.current||(doctor?!c.offer||!!c.answer:!!c.offer)} onClick={()=>void startCall()}>{doctor?"Answer call":"Start "+(c.mode==="VIDEO"?"video call":"voice call")}</button><button className="rc-outline" disabled={!activeId.current} onClick={()=>toggleTrack("audio")}>{muted?"Unmute":"Mute"}</button>{c.mode==="VIDEO"&&<button className="rc-outline" disabled={!activeId.current} onClick={()=>toggleTrack("video")}>{cameraOff?"Camera on":"Camera off"}</button>}<button className="rc-danger" disabled={busy||(!activeId.current&&!c.offer)} onClick={()=>void hangup()}>End call</button></div><p className="rc-small">{doctor?"Patient starts the call; answer when their offer appears.":"Ask your doctor to open their consultation workspace and answer."} Browser calls require camera/microphone permission, HTTPS or localhost and a reachable network. No recording.</p></div>}
        {permitted&&c.mode==="PHONE"&&<div className="rc-phone"><h3>Telephone consultation</h3>{data.phone?<button disabled={busy} onClick={async()=>{if(await run("dial",{id:c.id}))window.location.href="tel:"+data.phone;}}>Open telephone dialer</button>:<p>No authorized demo destination is configured. Set REMOTE_DEMO_PHONE on the server to enable dialing.</p>}<p className="rc-small">Uses your device’s telephone handler. The portal logs a dial request only, not connection or duration.</p></div>}
        <h3>Consultation chat</h3><div className="rc-chat" aria-label="Conversation">{c.messages.length?c.messages.map(m=><div key={m.id} className={"rc-message "+(m.authorId===user.id?"rc-mine":"")}><strong>{m.authorName}</strong><p>{m.body}</p><small>{formatDate(m.createdAt)}</small></div>):<p>No messages yet.</p>}</div>
        {permitted?<form className="rc-compose" onSubmit={async e=>{e.preventDefault();if(await run("message",{id:c.id,body:chat}))setChat("");}}><input aria-label="Message" value={chat} onChange={e=>setChat(e.target.value)} maxLength={2000} required placeholder="Write a message…"/><button disabled={busy||!chat.trim()}>Send</button></form>:<p className="rc-small">Chat opens after the doctor accepts and patient consent is recorded. Closed consultations are read-only.</p>}
      </>}</section>
    </div>}
    <footer className="rc-footer">UbuntuCare SA · Synthetic-data demonstration · No live hospital, billing or emergency-service connection</footer>
  </main>;
}
