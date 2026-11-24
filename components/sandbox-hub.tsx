"use client";
import { useState } from "react";
const all=["patient","admin","doctor","nurse","paramedic","billing","insurer"];
const modules=[
 {title:"Hospital operations",href:"/operations",desc:"Ward bed allocation, cleaning status, consumable stock and movement history.",roles:["admin","nurse"]},
 {title:"Connected care & claims",href:"/journey",desc:"Emergency dispatch, admission, treatment, discharge, laboratory and insurer workflows.",roles:all},
 {title:"Patient arrivals & referrals",href:"/intake",desc:"Walk-in, elective, EMS, transfer, temporary identity and secure referral handover.",roles:["admin","doctor","nurse","paramedic"]},
 {title:"Virtual care & activation",href:"/remote",desc:"Appointments, identity onboarding, video/voice, chat and configured telephone fallback.",roles:["patient","admin","doctor"]},
 {title:"Paperless document centre",href:"/paperless",desc:"Pre-admissions, consent, PDF documents, signatures and remittance reconciliation.",roles:["patient","admin","doctor","nurse","billing"]},
 {title:"Hospital clinical workspace",href:"/portal",desc:"Appointments, observations, medications, scans, theatre and administrative tasks.",roles:["patient","admin","doctor","nurse"]},
 {title:"Integration simulator",href:"/integration-lab",desc:"Synthetic partner contract tests, success and error scenarios and response evidence.",roles:["admin","billing","doctor","nurse","paramedic"]}
];
const cases=[
 ["Walk-in admission","Register fictional patient, assign doctor, record arrival and handover."],
 ["Unidentified emergency","Create a temporary intake without ID or funding; care must not wait."],
 ["Ambulance transfer","Create pre-alert, attach fictional PDF, assign receiving doctor and acknowledge."],
 ["Elective admission","Patient submits planned admission, admissions reviews it, signs forms."],
 ["Remote consultation","Use two browser profiles to book, accept, chat and attempt audio/video."],
 ["Laboratory result","Doctor orders, nurse collects, enter result, doctor reviews before patient release."],
 ["Paperless consent","Issue procedure form, clinician signs first, patient signs and downloads evidence."],
 ["Medical aid","Verify synthetic eligibility, authorise, invoice, submit, correct and reconcile."],
 ["Access control","Use another patient/crew account and verify unrelated records cannot be accessed."]
];
export default function SandboxHub({user}:{user:{name:string;role:string}}){
 const [checked,setChecked]=useState<string[]>([]);
 return <main className="rc-shell"><header className="rc-header"><div><a className="rc-brand" href="/">✚ UbuntuCare <span>SA</span></a><div className="rc-kicker">NATIONAL HEALTHCARE PLATFORM</div></div><nav><a href="/login">Switch role</a><a href="/journey">Care journey</a></nav></header><div className="rc-banner"><strong>Private synthetic-data sandbox.</strong> No real patient information, credentials, biometric data or emergency use. No partner is connected.</div><section className="rc-hero"><div><span className="rc-kicker">CONNECTED HEALTHCARE · SOUTH AFRICA</span><h1>National healthcare sandbox</h1><p>One entry point for hospital, patient, ambulance and funding demonstrations.</p></div><div className="rc-user">{user.name} · {user.role}</div></section><div className="rc-columns">{modules.filter(m=>m.roles.includes(user.role)).map(m=><section key={m.href} className="rc-card"><span className="rc-kicker">WORKSPACE</span><h2>{m.title}</h2><p>{m.desc}</p><a href={m.href}>Open workspace →</a></section>)}</div><section className="rc-card"><h2>Guided user acceptance testing</h2><p>{checked.length} of {cases.length} scenarios marked reviewed in this browser session. This is a personal checklist, not automated certification.</p>{cases.map(([title,description])=><label className="rc-check" key={title} style={{padding:"12px 0",borderBottom:"1px solid #dce8ea"}}><input type="checkbox" checked={checked.includes(title)} onChange={e=>setChecked(old=>e.target.checked?[...old,title]:old.filter(x=>x!==title))}/><span><strong>{title}</strong><br/>{description}</span></label>)}</section><footer className="rc-footer">UbuntuCare SA · not a clinical service or nationally approved platform</footer></main>;
}
