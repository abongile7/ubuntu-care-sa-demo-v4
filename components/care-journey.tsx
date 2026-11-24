"use client";

import {
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactElement,
  type ReactNode
} from "react";
import { useRouter } from "next/navigation";
import { encounterStatuses, readable, roleLabels, transitionRoles } from "@/lib/care-constants";
import type { JourneyActor, JourneyClaim, JourneyPayload } from "@/lib/care-types";

function Field({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  return (
    <div className="cj-field">
      <label htmlFor={id}>{label}</label>
      {isValidElement(children)
        ? cloneElement(children as ReactElement<{ id: string }>, { id })
        : children}
    </div>
  );
}
function Card({
  title,
  eyebrow,
  children
}: {
  title: string;
  eyebrow?: string;
  children: ReactNode;
}) {
  return (
    <section className="cj-card">
      <div className="cj-card-heading">
        {eyebrow && <span className="cj-eyebrow">{eyebrow}</span>}
        <h2>{title}</h2>
      </div>
      {children}
    </section>
  );
}
function Badge({ value }: { value: string }) {
  return <span className={`cj-badge cj-status-${value.toLowerCase()}`}>{readable(value)}</span>;
}
function Empty({ children }: { children: ReactNode }) {
  return <p className="cj-empty">{children}</p>;
}
const rand = (cents: number) =>
  new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(cents / 100);
const time = (value: string) =>
  new Intl.DateTimeFormat("en-ZA", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Africa/Johannesburg"
  }).format(new Date(value));
function formValues(event: FormEvent<HTMLFormElement>) {
  event.preventDefault();
  return Object.fromEntries(new FormData(event.currentTarget).entries()) as Record<string, string>;
}
function cents(value: string) {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value))
    throw new Error("Enter an amount in rand, with no more than two decimal places.");
  const [whole, fraction = ""] = value.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

export function CareJourney({ initialSession }: { initialSession: JourneyActor }) {
  const router = useRouter();
  const [data, setData] = useState<JourneyPayload | null>(null);
  const [busy, setBusy] = useState(true);
  const [tab, setTab] = useState(initialSession.role === "insurer" ? "claims" : "overview");
  const [notice, setNotice] = useState<{ error: boolean; text: string } | null>(null);
  const [validation, setValidation] = useState<string[]>([]);
  const [draftKey, setDraftKey] = useState(0);
  const sequence = useRef(0);
  const selected = useRef("");
  const mutation = useRef(false);
  const request = useRef<AbortController | null>(null);
  const role = initialSession.role;
  const finance = role === "admin" || role === "billing";
  const clinical = role === "doctor" || role === "nurse";
  const hospital = clinical || role === "admin";
  const canCall = hospital || role === "paramedic" || role === "billing";

  async function load(id = selected.current) {
    const current = ++sequence.current;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    try {
      const response = await fetch(
        `/api/journey${id ? `?encounterId=${encodeURIComponent(id)}` : ""}`,
        { signal: controller.signal, cache: "no-store" }
      );
      const result = await response.json();
      if (current !== sequence.current) return;
      if (!response.ok) throw new Error(result.message || "Unable to load the care journey.");
      selected.current = result.activeEncounter?.id ?? "";
      setData(result as JourneyPayload);
    } catch (error) {
      if (current !== sequence.current || controller.signal.aborted) return;
      setNotice({
        error: true,
        text: error instanceof Error ? error.message : "Unable to load the journey."
      });
    } finally {
      if (current === sequence.current) setBusy(false);
    }
  }
  useEffect(() => {
    void load();
    return () => {
      sequence.current += 1;
      request.current?.abort();
    };
    // The initial session is supplied by the authenticated server page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function switchEncounter(id: string) {
    if (mutation.current || busy || id === selected.current) return;
    selected.current = id;
    setDraftKey((key) => key + 1);
    setNotice(null);
    setValidation([]);
    void load(id);
  }

  async function run(endpoint: string, body: Record<string, unknown>, success: string) {
    if (mutation.current || busy) return;
    mutation.current = true;
    setBusy(true);
    setNotice(null);
    setValidation([]);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ encounterId: selected.current, ...body })
      });
      const result = await response.json();
      if (!response.ok || !result.ok)
        throw new Error(result.message || "Unable to save this action.");
      if (result.valid === false) {
        setValidation(result.errors ?? ["This claim needs more information."]);
        setNotice({ error: true, text: "Claim needs attention before submission." });
      } else setNotice({ error: false, text: success });
      if (body.action === "createEncounter" && result.encounter?.id) {
        selected.current = result.encounter.id;
        setDraftKey((key) => key + 1);
      }
      await load(selected.current);
    } catch (error) {
      setNotice({
        error: true,
        text: error instanceof Error ? error.message : "Unable to save this action."
      });
    } finally {
      mutation.current = false;
      setBusy(false);
    }
  }
  function act(body: Record<string, unknown>, success = "Care record updated.") {
    return run("/api/journey", body, success);
  }
  function fund(
    body: Record<string, unknown>,
    success = "Simulation completed. No external service was contacted."
  ) {
    return run("/api/integrations", body, success);
  }
  function claimAct(
    claim: JourneyClaim,
    body: Record<string, unknown>,
    success = "Simulated claim updated."
  ) {
    return run("/api/claims", { claimId: claim.id, version: claim.version, ...body }, success);
  }
  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  const encounter = data?.activeEncounter;
  const patient = encounter?.patient;
  const next = encounter
    ? encounterStatuses[
        encounterStatuses.indexOf(encounter.status as (typeof encounterStatuses)[number]) + 1
      ]
    : undefined;
  const nextRoles = next ? (transitionRoles[next] ?? []) : [];
  const canTransition = Boolean(next && nextRoles.includes(role));
  const open = Boolean(
    encounter && !["READY_FOR_DISCHARGE", "DISCHARGED"].includes(encounter.status)
  );
  const careOpen = Boolean(open && encounter && ["ADMITTED", "IN_CARE"].includes(encounter.status));
  const latestEligibility = data?.eligibilityChecks[0];
  const tabs = [
    { id: "overview", label: role === "paramedic" ? "Dispatch & handover" : "Care journey" },
    ...(hospital || role === "patient" ? [{ id: "clinical", label: "Clinical care" }] : []),
    ...(finance ? [{ id: "funding", label: "Identity & medical aid" }] : []),
    ...(finance || role === "insurer" || role === "patient"
      ? [{ id: "claims", label: "Claims" }]
      : []),
    { id: "activity", label: "Activity" }
  ];

  return (
    <main className="cj-app">
      <header className="cj-topbar">
        <a className="cj-brand" href="/">
          <span className="cj-logo">✚</span>
          <span>
            UbuntuCare<small>CONNECTED CARE · SOUTH AFRICA</small>
          </span>
        </a>
        <div className="cj-user">
          <div>
            <strong>{initialSession.name}</strong>
            <small>
              {roleLabels[role]}
              {initialSession.organization ? ` · ${initialSession.organization}` : ""}
            </small>
          </div>
          <button className="cj-button cj-button-quiet" type="button" onClick={() => void logout()}>
            Sign out
          </button>
        </div>
      </header>
      <div className="cj-simulation">
        <strong>SIMULATED SERVICES</strong>
        <span>
          Fictional patient data only. Calls, Home Affairs checks, medical-aid submissions and
          payments are simulated.
        </span>
      </div>
      <div className="cj-layout">
        <aside className="cj-sidebar">
          <span className="cj-eyebrow">YOUR WORKSPACE</span>
          <h1>{roleLabels[role]}</h1>
          <p>One connected journey, with the information your role needs.</p>
          <nav aria-label="Workspace">
            {tabs.map((item) => (
              <button
                key={item.id}
                type="button"
                className={tab === item.id ? "cj-nav-active" : ""}
                aria-current={tab === item.id ? "page" : undefined}
                onClick={() => setTab(item.id)}
              >
                {item.label}
                <span aria-hidden="true">→</span>
              </button>
            ))}
          </nav>
          <div className="cj-sidebar-footer">
            <span className="cj-live-dot" />
            Demo database connected
            {["patient", "doctor", "nurse", "admin"].includes(role) && (
              <a href="/portal">Detailed hospital workspace ↗</a>
            )}
            {["patient", "doctor", "admin"].includes(role) && <a href="/remote">Patient onboarding & remote consultations ↗</a>}
            <button type="button" disabled={busy} onClick={() => void load()}>
              Refresh records
            </button>
          </div>
        </aside>
        <div className="cj-main">
          <div className="cj-page-title">
            <div>
              <span className="cj-eyebrow">
                {role === "insurer" ? "CONSENTED CLAIM REVIEW" : "FROM FIRST CALL TO FINAL CLAIM"}
              </span>
              <h1>{tabs.find((item) => item.id === tab)?.label}</h1>
            </div>
            <span className="cj-demo-pill">Demo environment</span>
          </div>
          {notice && (
            <div
              className={`cj-notice ${notice.error ? "cj-notice-error" : ""}`}
              role={notice.error ? "alert" : "status"}
            >
              {notice.text}
            </div>
          )}
          {!!validation.length && (
            <ul className="cj-validation">
              {validation.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          )}
          {busy && (
            <p className="cj-loading" role="status">
              Loading or saving the selected encounter…
            </p>
          )}
          <div className="cj-context">
            <Field
              label={role === "insurer" ? "Shared claim encounter" : "Selected patient encounter"}
            >
              <select
                aria-label="Selected patient encounter"
                disabled={busy || !data?.encounters.length}
                value={selected.current}
                onChange={(event) => switchEncounter(event.target.value)}
              >
                <option value="" disabled>
                  Select an encounter
                </option>
                {data?.encounters.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.patient.fullName} · {readable(item.status)} · {item.reference.slice(-8)}
                  </option>
                ))}
              </select>
            </Field>
            {encounter && (
              <div className="cj-context-reference">
                <span>Encounter reference</span>
                <strong>{encounter.reference.slice(0, 18)}…</strong>
              </div>
            )}
          </div>
          <fieldset className="cj-workspace" disabled={busy} aria-busy={busy} key={draftKey}>
            {encounter && patient ? (
              <>
                <section className="cj-patient-card">
                  <div>
                    <span className="cj-eyebrow">{patient.facilityFileNumber}</span>
                    <h2>{patient.fullName}</h2>
                    <p>{encounter.chiefComplaint || patient.medicalAidScheme}</p>
                  </div>
                  <div className="cj-patient-status">
                    <Badge value={encounter.status} />
                    {encounter.triage && (
                      <span className={`cj-triage cj-triage-${encounter.triage.toLowerCase()}`}>
                        {encounter.triage} triage
                      </span>
                    )}
                    <small>
                      {encounter.ward
                        ? `${encounter.ward} · ${encounter.bed}`
                        : "Care location pending"}
                    </small>
                  </div>
                </section>
                <ol className="cj-progress" aria-label="Patient journey stages">
                  {encounterStatuses.map((stage, index) => (
                    <li
                      key={stage}
                      className={
                        index <=
                        encounterStatuses.indexOf(
                          encounter.status as (typeof encounterStatuses)[number]
                        )
                          ? "cj-step-done"
                          : ""
                      }
                      aria-current={stage === encounter.status ? "step" : undefined}
                    >
                      <span>
                        {index <
                        encounterStatuses.indexOf(
                          encounter.status as (typeof encounterStatuses)[number]
                        )
                          ? "✓"
                          : index + 1}
                      </span>
                      <small>{readable(stage)}</small>
                    </li>
                  ))}
                </ol>
                {tab === "overview" && (
                  <>
                    <div className="cj-two-columns">
                      <Card
                        title={next ? "Next step in care" : "Encounter completed"}
                        eyebrow="WORKFLOW CONTROL"
                      >
                        {next ? (
                          <>
                            <p className="cj-next-step">{readable(next)}</p>
                            {canTransition ? (
                              <form
                                onSubmit={(event) => {
                                  const values = formValues(event);
                                  void act(
                                    {
                                      action: "transition",
                                      status: next,
                                      version: encounter.version,
                                      ...values
                                    },
                                    `Patient moved to ${readable(next)}.`
                                  );
                                }}
                              >
                                {next === "ADMITTED" && (
                                  <div className="cj-form-grid">
                                    <Field label="Ward">
                                      <input
                                        name="ward"
                                        defaultValue={encounter.ward || "Ward B7"}
                                        required
                                        maxLength={80}
                                      />
                                    </Field>
                                    <Field label="Bed">
                                      <input
                                        name="bed"
                                        defaultValue={encounter.bed || "B7-01"}
                                        required
                                        maxLength={40}
                                      />
                                    </Field>
                                  </div>
                                )}
                                {next === "READY_FOR_DISCHARGE" && (
                                  <>
                                    <Field label="Diagnosis code">
                                      <input
                                        name="diagnosisCode"
                                        placeholder="R51"
                                        required
                                        maxLength={20}
                                      />
                                    </Field>
                                    <Field label="Clinical summary">
                                      <textarea name="clinicalSummary" required maxLength={5000} />
                                    </Field>
                                    <Field label="Discharge instructions">
                                      <textarea name="dischargeSummary" required maxLength={5000} />
                                    </Field>
                                  </>
                                )}
                                <button className="cj-button" type="submit">
                                  Move to {readable(next)} →
                                </button>
                              </form>
                            ) : (
                              <p className="cj-muted">
                                Next action belongs to:{" "}
                                {nextRoles.map((item) => roleLabels[item]).join(" or ")}.
                              </p>
                            )}
                          </>
                        ) : (
                          <p>
                            Discharge is complete. Billing can prepare the final claim independently
                            of clinical care.
                          </p>
                        )}
                      </Card>
                      <Card title="Patient context" eyebrow="CURRENT RECORD">
                        <dl className="cj-details">
                          {encounter.location && (
                            <>
                              <dt>Pickup / referral</dt>
                              <dd>{encounter.location}</dd>
                            </>
                          )}
                          <dt>Medical aid</dt>
                          <dd>{patient.medicalAidScheme}</dd>
                          {patient.memberNumberMasked && (
                            <>
                              <dt>Membership</dt>
                              <dd>{patient.memberNumberMasked}</dd>
                            </>
                          )}
                          {patient.allergies && (
                            <>
                              <dt>Recorded allergies</dt>
                              <dd>{patient.allergies}</dd>
                            </>
                          )}
                          {patient.chronicConditions && (
                            <>
                              <dt>Patient history</dt>
                              <dd>{patient.chronicConditions}</dd>
                            </>
                          )}
                          <dt>Opened</dt>
                          <dd>{time(encounter.openedAt)}</dd>
                        </dl>
                      </Card>
                    </div>
                    {(role === "paramedic" || role === "nurse") && open && (
                      <Card title="Ambulance and hospital handover" eyebrow="CONTINUITY OF CARE">
                        <p>
                          Record the assessment and handover before moving the patient to hospital
                          handover.
                        </p>
                        <form
                          onSubmit={(event) => {
                            const values = formValues(event);
                            void act(
                              { action: "addNote", category: "Handover", ...values },
                              "Handover recorded."
                            );
                          }}
                        >
                          <Field label="Handover notes">
                            <textarea
                              name="body"
                              required
                              maxLength={5000}
                              placeholder="Fictional assessment, observations, treatment and receiving team…"
                            />
                          </Field>
                          <button className="cj-button" type="submit">
                            Save handover
                          </button>
                        </form>
                      </Card>
                    )}
                    {canCall && (
                      <Card title="Calls and coordination" eyebrow="SIMULATED PHONE SERVICE">
                        <p>
                          Log inbound or outbound conversations for the demonstration. No call is
                          placed and no audio is recorded.
                        </p>
                        <form
                          onSubmit={(event) => {
                            const values = formValues(event);
                            void fund(
                              { action: "simulateCall", ...values },
                              "Simulated call logged. No call was placed."
                            );
                          }}
                          className="cj-form-grid"
                        >
                          <Field label="Direction">
                            <select name="direction">
                              <option value="INBOUND">Inbound</option>
                              <option value="OUTBOUND">Outbound</option>
                            </select>
                          </Field>
                          <Field label="Purpose">
                            <select name="purpose">
                              {role !== "billing" && (
                                <option value="EMS">Emergency / ambulance</option>
                              )}
                              {role !== "paramedic" && (
                                <option value="MEDICAL_AID">Medical aid</option>
                              )}
                              {role !== "billing" && (
                                <option value="NEXT_OF_KIN">Next of kin</option>
                              )}
                            </select>
                          </Field>
                          <Field label="Contact name">
                            <input name="contactName" required maxLength={160} />
                          </Field>
                          <Field label="Contact phone">
                            <input
                              name="phone"
                              type="tel"
                              required
                              maxLength={40}
                              placeholder="Fictional phone number"
                            />
                          </Field>
                          <div className="cj-span-full">
                            <Field label="Call notes">
                              <textarea name="summary" required maxLength={2000} />
                            </Field>
                            <button className="cj-button" type="submit">
                              Log simulated call
                            </button>
                          </div>
                        </form>
                        <div className="cj-record-list">
                          {data.calls.map((call) => (
                            <article key={call.id}>
                              <div>
                                <strong>
                                  {call.contactName} · {readable(call.purpose)}
                                </strong>
                                <Badge value={call.status} />
                              </div>
                              <p>{call.summary}</p>
                              <small>
                                {readable(call.direction)} · {time(call.createdAt)}
                              </small>
                            </article>
                          ))}
                        </div>
                      </Card>
                    )}
                    {(role === "admin" || role === "patient") && (
                      <Card title="Patient consent choices" eyebrow="INFORMATION SHARING">
                        <p>
                          Record privacy acknowledgement, treatment and medical-aid information
                          sharing separately. Revoking sharing blocks further insurer access in this
                          demo.
                        </p>
                        <form
                          onSubmit={(event) => {
                            const values = formValues(event);
                            void act(
                              {
                                action: "recordConsent",
                                popiaConsent: values.popiaConsent === "on",
                                consentTreatment: values.consentTreatment === "on",
                                consentDataSharing: values.consentDataSharing === "on"
                              },
                              "Consent choices recorded."
                            );
                          }}
                        >
                          <label className="cj-checkbox">
                            <input
                              type="checkbox"
                              name="popiaConsent"
                              defaultChecked={patient.popiaConsent}
                            />
                            Privacy information acknowledged
                          </label>
                          <label className="cj-checkbox">
                            <input
                              type="checkbox"
                              name="consentTreatment"
                              defaultChecked={patient.consentTreatment}
                            />
                            Treatment consent recorded
                          </label>
                          <label className="cj-checkbox">
                            <input
                              type="checkbox"
                              name="consentDataSharing"
                              defaultChecked={patient.consentDataSharing}
                            />
                            Share the necessary claim information with medical aid
                          </label>
                          <button className="cj-button cj-button-secondary" type="submit">
                            Save consent choices
                          </button>
                        </form>
                      </Card>
                    )}
                  </>
                )}
                {tab === "clinical" && (
                  <>
                    {encounter.dischargeSummary && (
                      <Card title="Discharge and follow-up" eyebrow="DOCTOR SUMMARY">
                        <p className="cj-preserve">{encounter.dischargeSummary}</p>
                        <small>Diagnosis: {encounter.diagnosisCode}</small>
                      </Card>
                    )}
                    {clinical && open && (
                      <Card title="Clinical notes and patient updates" eyebrow="CARE TEAM">
                        <form
                          onSubmit={(event) => {
                            const values = formValues(event);
                            void act({ action: "addNote", ...values }, "Care note saved.");
                          }}
                        >
                          <Field label="Note visibility">
                            <select name="category">
                              <option value="Clinical">Internal clinical note</option>
                              <option value="Patient update">Patient-visible update</option>
                              <option value="Handover">Handover</option>
                            </select>
                          </Field>
                          <Field label="Care note">
                            <textarea name="body" required maxLength={5000} />
                          </Field>
                          <button className="cj-button" type="submit">
                            Save care note
                          </button>
                        </form>
                      </Card>
                    )}
                    <Card
                      title="Laboratory orders and results"
                      eyebrow={
                        role === "patient"
                          ? "CLINICIAN-REVIEWED RESULTS"
                          : "REQUEST → COLLECT → REPORT → REVIEW"
                      }
                    >
                      {role === "doctor" &&
                        open &&
                        ["ADMITTED", "IN_CARE"].includes(encounter.status) && (
                          <form
                            className="cj-form-grid"
                            onSubmit={(event) => {
                              const values = formValues(event);
                              void act(
                                { action: "orderLab", ...values },
                                "Laboratory order created."
                              );
                            }}
                          >
                            <Field label="Test name">
                              <input
                                name="testName"
                                required
                                maxLength={200}
                                placeholder="DEMO full blood count"
                              />
                            </Field>
                            <Field label="Specimen">
                              <input
                                name="specimen"
                                required
                                defaultValue="Blood"
                                maxLength={100}
                              />
                            </Field>
                            <button className="cj-button" type="submit">
                              Request laboratory test
                            </button>
                          </form>
                        )}
                      {!data.labOrders.length && (
                        <Empty>
                          {role === "patient"
                            ? "Results appear after a doctor has reviewed and released them."
                            : "No laboratory orders for this encounter."}
                        </Empty>
                      )}
                      <div className="cj-record-list">
                        {data.labOrders.map((lab) => (
                          <article key={lab.id}>
                            <div>
                              <strong>{lab.testName}</strong>
                              <Badge value={lab.status} />
                            </div>
                            <small>
                              {lab.specimen} · {time(lab.createdAt)}
                            </small>
                            {lab.resultSummary && (
                              <p className="cj-preserve">
                                {lab.resultSummary} <strong>{lab.abnormalFlag}</strong>
                              </p>
                            )}
                            {clinical && open && lab.status === "REQUESTED" && (
                              <button
                                type="button"
                                className="cj-button cj-button-secondary"
                                onClick={() =>
                                  void act(
                                    { action: "collectLab", labOrderId: lab.id },
                                    "Specimen collection recorded."
                                  )
                                }
                              >
                                Record specimen collection
                              </button>
                            )}
                            {clinical && open && lab.status === "COLLECTED" && (
                              <form
                                onSubmit={(event) => {
                                  const values = formValues(event);
                                  void act(
                                    { action: "resultLab", labOrderId: lab.id, ...values },
                                    "Simulated result recorded; awaiting doctor review."
                                  );
                                }}
                              >
                                <Field label={`Result for ${lab.testName}`}>
                                  <textarea name="resultSummary" required maxLength={5000} />
                                </Field>
                                <Field label="Result flag">
                                  <select name="abnormalFlag">
                                    <option>Normal</option>
                                    <option>Abnormal</option>
                                    <option>Critical</option>
                                  </select>
                                </Field>
                                <button className="cj-button" type="submit">
                                  Record simulated result
                                </button>
                              </form>
                            )}
                            {role === "doctor" && open && lab.status === "RESULTED" && (
                              <button
                                className="cj-button"
                                type="button"
                                onClick={() =>
                                  void act(
                                    { action: "reviewLab", labOrderId: lab.id },
                                    "Result reviewed and released to the patient."
                                  )
                                }
                              >
                                Review and release result
                              </button>
                            )}
                            {role === "doctor" &&
                              open &&
                              !["REVIEWED", "CANCELLED"].includes(lab.status) && (
                                <button
                                  className="cj-button cj-button-quiet"
                                  type="button"
                                  onClick={() =>
                                    void act(
                                      { action: "cancelLab", labOrderId: lab.id },
                                      "Laboratory order cancelled."
                                    )
                                  }
                                >
                                  Cancel order
                                </button>
                              )}
                          </article>
                        ))}
                      </div>
                    </Card>
                    <div className="cj-two-columns">
                      <Card title="Observations" eyebrow="PATIENT CHART">
                        {data.vitals[0] ? (
                          <div className="cj-observation">
                            <strong>
                              {data.vitals[0].systolic}/{data.vitals[0].diastolic}
                              <small>mmHg · latest blood pressure</small>
                            </strong>
                            <span>
                              {data.vitals[0].pulse} bpm · SpO₂ {data.vitals[0].spo2}%
                              <small>{time(data.vitals[0].recordedAt)}</small>
                            </span>
                          </div>
                        ) : (
                          <Empty>No observations recorded.</Empty>
                        )}
                        {clinical && careOpen && (
                          <form
                            className="cj-form-grid"
                            onSubmit={(event) => {
                              const values = formValues(event);
                              void act(
                                {
                                  action: "recordVitals",
                                  systolic: Number(values.systolic),
                                  diastolic: Number(values.diastolic),
                                  pulse: Number(values.pulse),
                                  temperature: Number(values.temperature),
                                  spo2: Number(values.spo2),
                                  respiratoryRate: 18,
                                  painScore: 0,
                                  glucose: "",
                                  notes: "Fictional connected-care observation"
                                },
                                "Observations saved."
                              );
                            }}
                          >
                            <Field label="Systolic">
                              <input name="systolic" type="number" required min="1" max="300" />
                            </Field>
                            <Field label="Diastolic">
                              <input name="diastolic" type="number" required min="1" max="200" />
                            </Field>
                            <Field label="Pulse">
                              <input name="pulse" type="number" required min="1" max="300" />
                            </Field>
                            <Field label="Temperature °C">
                              <input
                                name="temperature"
                                type="number"
                                step="0.1"
                                required
                                min="25"
                                max="45"
                              />
                            </Field>
                            <Field label="SpO₂ %">
                              <input name="spo2" type="number" required min="1" max="100" />
                            </Field>
                            <button className="cj-button" type="submit">
                              Save observations
                            </button>
                          </form>
                        )}
                      </Card>
                      <Card title="Medication and treatment" eyebrow="PATIENT CHART">
                        {role === "doctor" && careOpen && (
                          <form
                            onSubmit={(event) => {
                              const values = formValues(event);
                              void act(
                                {
                                  action: "prescribeMedication",
                                  ...values,
                                  route: "Oral",
                                  startDate: new Date().toISOString().slice(0, 10)
                                },
                                "Demo medication prescribed."
                              );
                            }}
                            className="cj-form-grid"
                          >
                            <Field label="Medication">
                              <input name="drugName" required maxLength={200} />
                            </Field>
                            <Field label="Dose">
                              <input name="dose" required maxLength={100} />
                            </Field>
                            <Field label="Frequency">
                              <input name="frequency" required maxLength={100} />
                            </Field>
                            <Field label="Indication">
                              <input name="indication" maxLength={200} />
                            </Field>
                            <button className="cj-button" type="submit">
                              Add oral medication order
                            </button>
                          </form>
                        )}
                        <div className="cj-record-list">
                          {data.medications.map((medication) => (
                            <article key={medication.id}>
                              <strong>
                                {medication.drugName} · {medication.dose}
                              </strong>
                              <p>
                                {medication.route} · {medication.frequency} · {medication.status}
                              </p>
                              {clinical && careOpen && medication.status === "Active" && (
                                <form
                                  onSubmit={(event) => {
                                    const values = formValues(event);
                                    void act(
                                      {
                                        action: "administerMedication",
                                        orderId: medication.id,
                                        ...values
                                      },
                                      "Simulated administration recorded."
                                    );
                                  }}
                                >
                                  <Field label={`Administration of ${medication.drugName}`}>
                                    <select name="status">
                                      <option>Given</option>
                                      <option>Withheld</option>
                                      <option>Missed</option>
                                    </select>
                                  </Field>
                                  <Field label="Administration notes">
                                    <input name="notes" maxLength={1000} />
                                  </Field>
                                  <button className="cj-button cj-button-secondary" type="submit">
                                    Log administration
                                  </button>
                                </form>
                              )}
                            </article>
                          ))}
                        </div>
                        {!data.medications.length && <Empty>No medication orders recorded.</Empty>}
                        <div className="cj-record-list">
                          {data.administrations.slice(0, 5).map((item) => (
                            <article key={item.id}>
                              <strong>
                                {item.status} ·{" "}
                                {data.medications.find((med) => med.id === item.orderId)
                                  ?.drugName ?? "Medication"}
                              </strong>
                              <small>
                                {item.administeredBy} · {time(item.administeredAt)}
                              </small>
                            </article>
                          ))}
                        </div>
                      </Card>
                    </div>
                    <Card title={role === "patient" ? "Care team updates" : "Care notes"}>
                      <div className="cj-record-list">
                        {data.notes.map((note) => (
                          <article key={note.id}>
                            <div>
                              <strong>{note.category}</strong>
                              <small>{note.authorName}</small>
                            </div>
                            <p className="cj-preserve">{note.body}</p>
                            <small>{time(note.createdAt)}</small>
                          </article>
                        ))}
                      </div>
                      {!data.notes.length && <Empty>No updates available.</Empty>}
                    </Card>
                  </>
                )}
                {tab === "funding" && finance && (
                  <>
                    <div className="cj-two-columns">
                      {role === "admin" && (
                        <Card title="Identity verification" eyebrow="HOME AFFAIRS SIMULATION">
                          <p>
                            Check the identity already recorded for this fictional patient. This
                            demonstration does not search government records or retrieve another
                            person's details.
                          </p>
                          <form
                            onSubmit={(event) => {
                              const values = formValues(event);
                              void fund({
                                action: "verifyIdentity",
                                ...values,
                                consentConfirmed: values.consentConfirmed === "on"
                              });
                            }}
                          >
                            <Field label="Verification purpose">
                              <input
                                name="purpose"
                                required
                                defaultValue="Fictional hospital admission identity check"
                                maxLength={300}
                              />
                            </Field>
                            <Field label="Identity simulation scenario">
                              <select name="scenario">
                                <option value="match">Match</option>
                                <option value="mismatch">No match</option>
                                <option value="unavailable">Provider unavailable</option>
                              </select>
                            </Field>
                            <label className="cj-checkbox">
                              <input name="consentConfirmed" type="checkbox" required />
                              Privacy consent and purpose confirmed
                            </label>
                            <button className="cj-button" type="submit">
                              Simulate identity check
                            </button>
                          </form>
                          <div className="cj-record-list">
                            {data.identityChecks.map((check) => (
                              <article key={check.id}>
                                <Badge value={check.status} />
                                <p>Identity ending {check.idLast4}</p>
                                <small>{time(check.createdAt)} · Simulated</small>
                              </article>
                            ))}
                          </div>
                        </Card>
                      )}
                      <Card
                        title="Medical-aid eligibility and authorisation"
                        eyebrow="SIMULATED BENEFITS SERVICE"
                      >
                        <p>
                          {patient.medicalAidScheme} · {patient.memberNumberMasked}
                        </p>
                        {latestEligibility && (
                          <div className="cj-benefits">
                            <Badge value={latestEligibility.status} />
                            <Badge value={latestEligibility.authorizationStatus} />
                            {latestEligibility.authorizationReference && (
                              <small>{latestEligibility.authorizationReference}</small>
                            )}
                          </div>
                        )}
                        <form
                          onSubmit={(event) => {
                            const values = formValues(event);
                            void fund({
                              action: "checkEligibility",
                              ...values,
                              consentConfirmed: values.consentConfirmed === "on"
                            });
                          }}
                        >
                          <Field label="Eligibility purpose">
                            <input
                              name="purpose"
                              required
                              defaultValue="Fictional hospital admission benefits check"
                              maxLength={300}
                            />
                          </Field>
                          <Field label="Eligibility simulation scenario">
                            <select name="scenario">
                              <option value="eligible">Eligible</option>
                              <option value="not_found">Membership not found</option>
                              <option value="unavailable">Provider unavailable</option>
                            </select>
                          </Field>
                          <label className="cj-checkbox">
                            <input name="consentConfirmed" type="checkbox" required />
                            Patient sharing consent confirmed
                          </label>
                          <button className="cj-button" type="submit">
                            Check simulated eligibility
                          </button>
                        </form>
                        {latestEligibility?.status === "ELIGIBLE" && (
                          <form
                            onSubmit={(event) => {
                              const values = formValues(event);
                              void fund({
                                action: "requestAuthorization",
                                ...values,
                                consentConfirmed: values.consentConfirmed === "on"
                              });
                            }}
                          >
                            <Field label="Authorisation purpose">
                              <input
                                name="purpose"
                                required
                                defaultValue="Fictional hospital treatment authorisation"
                                maxLength={300}
                              />
                            </Field>
                            <Field label="Authorisation simulation scenario">
                              <select name="scenario">
                                <option value="approved">Approved</option>
                                <option value="declined">Declined</option>
                                <option value="unavailable">Provider unavailable</option>
                              </select>
                            </Field>
                            <label className="cj-checkbox">
                              <input name="consentConfirmed" type="checkbox" required />
                              Necessary information sharing confirmed
                            </label>
                            <button className="cj-button cj-button-secondary" type="submit">
                              Request simulated authorisation
                            </button>
                          </form>
                        )}
                        <p className="cj-footnote">
                          Funding status does not block emergency care, admission or discharge.
                        </p>
                      </Card>
                    </div>
                  </>
                )}
                {tab === "claims" && (
                  <>
                    <div className="cj-section-intro">
                      <div>
                        <h2>
                          {role === "insurer" ? "Medical-aid review queue" : "Hospital claims"}
                        </h2>
                        <p>
                          {role === "insurer"
                            ? "Review only the submitted, consented packet for your medical-aid scheme."
                            : "Prepare an invoice, validate the required records and follow the simulated claim through review and payment."}
                        </p>
                      </div>
                      {finance && !data.claims.some((claim) => claim.status !== "REJECTED") && (
                        <button
                          className="cj-button"
                          type="button"
                          onClick={() =>
                            void run("/api/claims", { action: "create" }, "Draft claim created.")
                          }
                        >
                          Create draft claim
                        </button>
                      )}
                    </div>
                    {!data.claims.length && (
                      <Card title="No claim available">
                        <Empty>
                          {role === "insurer"
                            ? "Claims appear after the hospital submits a consented packet for your scheme."
                            : "Hospital billing can create a draft claim for this encounter."}
                        </Empty>
                      </Card>
                    )}
                    {data.claims.map((claim) => (
                      <Card
                        key={claim.id}
                        title={`${claim.reference.slice(0, 16)}…`}
                        eyebrow={claim.scheme}
                      >
                        <div className="cj-claim-summary">
                          <Badge value={claim.status} />
                          <strong>{rand(claim.totalCents)}</strong>
                        </div>
                        {claim.reviewNote && (
                          <p className="cj-review-note">Medical-aid note: {claim.reviewNote}</p>
                        )}
                        {claim.diagnosisCode && (
                          <p className="cj-muted">
                            Diagnosis: {claim.diagnosisCode} · Membership:{" "}
                            {claim.memberNumberMasked}
                          </p>
                        )}
                        {!!claim.lineItems?.length && (
                          <div className="cj-table-wrap">
                            <table>
                              <caption>Claim invoice lines</caption>
                              <thead>
                                <tr>
                                  <th>Service</th>
                                  <th>Quantity</th>
                                  <th>Unit price</th>
                                  <th>Total</th>
                                  {finance && <th>Action</th>}
                                </tr>
                              </thead>
                              <tbody>
                                {claim.lineItems.map((line) => (
                                  <tr key={line.id}>
                                    <td>
                                      <strong>{line.serviceCode}</strong>
                                      <span>{line.description}</span>
                                    </td>
                                    <td>{line.quantity}</td>
                                    <td>{rand(line.unitPriceCents)}</td>
                                    <td>{rand(line.totalCents)}</td>
                                    {finance && (
                                      <td>
                                        {["DRAFT", "NEEDS_INFORMATION"].includes(claim.status) && (
                                          <button
                                            className="cj-text-button"
                                            type="button"
                                            onClick={() =>
                                              void claimAct(claim, {
                                                action: "removeLine",
                                                lineId: line.id
                                              })
                                            }
                                          >
                                            Remove
                                          </button>
                                        )}
                                      </td>
                                    )}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                        {finance && ["DRAFT", "NEEDS_INFORMATION"].includes(claim.status) && (
                          <form
                            className="cj-form-grid cj-invoice-form"
                            onSubmit={(event) => {
                              const values = formValues(event);
                              try {
                                void claimAct(
                                  claim,
                                  {
                                    action: "addLine",
                                    serviceCode: values.serviceCode,
                                    description: values.description,
                                    quantity: Number(values.quantity),
                                    unitPriceCents: cents(values.price)
                                  },
                                  "Invoice line added."
                                );
                              } catch (error) {
                                setNotice({
                                  error: true,
                                  text: error instanceof Error ? error.message : "Invalid price."
                                });
                              }
                            }}
                          >
                            <Field label="Service code">
                              <input
                                name="serviceCode"
                                required
                                maxLength={40}
                                placeholder="DEMO-CONSULT"
                              />
                            </Field>
                            <Field label="Description">
                              <input
                                name="description"
                                required
                                maxLength={300}
                                placeholder="Fictional ward consultation"
                              />
                            </Field>
                            <Field label="Quantity">
                              <input
                                name="quantity"
                                type="number"
                                min="1"
                                max="1000"
                                required
                                defaultValue="1"
                              />
                            </Field>
                            <Field label="Unit price (ZAR)">
                              <input
                                name="price"
                                inputMode="decimal"
                                required
                                placeholder="750.00"
                              />
                            </Field>
                            <button className="cj-button cj-button-secondary" type="submit">
                              Add invoice line
                            </button>
                          </form>
                        )}
                        <div className="cj-actions">
                          {finance &&
                            ["DRAFT", "NEEDS_INFORMATION", "VALIDATED"].includes(claim.status) && (
                              <button
                                className="cj-button cj-button-secondary"
                                type="button"
                                onClick={() =>
                                  void claimAct(
                                    claim,
                                    { action: "validate" },
                                    "Claim validation passed."
                                  )
                                }
                              >
                                Validate claim
                              </button>
                            )}
                          {finance && claim.status === "VALIDATED" && (
                            <button
                              className="cj-button"
                              type="button"
                              onClick={() =>
                                void claimAct(
                                  claim,
                                  { action: "submit" },
                                  "Claim submitted to the simulated medical-aid queue."
                                )
                              }
                            >
                              Submit simulated claim
                            </button>
                          )}
                          {finance && claim.status === "APPROVED" && (
                            <button
                              className="cj-button"
                              type="button"
                              onClick={() =>
                                void claimAct(
                                  claim,
                                  { action: "pay" },
                                  "Simulated payment recorded. No funds were transferred."
                                )
                              }
                            >
                              Record simulated payment
                            </button>
                          )}
                          {((finance && claim.sharedWithInsurer) || role === "insurer") && (
                            <a
                              className="cj-button cj-button-quiet"
                              href={`/api/claims/${claim.id}/export`}
                            >
                              Download submitted packet
                            </a>
                          )}
                        </div>
                        {role === "insurer" && claim.status === "SUBMITTED" && (
                          <form
                            className="cj-review-form"
                            onSubmit={(event) => {
                              const values = formValues(event);
                              void claimAct(
                                claim,
                                { action: "review", ...values },
                                "Simulated medical-aid review recorded."
                              );
                            }}
                          >
                            <Field label="Review decision">
                              <select name="decision">
                                <option value="APPROVED">Approve</option>
                                <option value="NEEDS_INFORMATION">Request information</option>
                                <option value="REJECTED">Reject</option>
                              </select>
                            </Field>
                            <Field label="Decision note">
                              <textarea
                                name="note"
                                maxLength={1000}
                                placeholder="Required for rejection or information requests"
                              />
                            </Field>
                            <button className="cj-button" type="submit">
                              Save simulated review
                            </button>
                          </form>
                        )}
                      </Card>
                    ))}
                  </>
                )}
                {tab === "activity" && (
                  <Card title="Encounter activity" eyebrow="RECORDED EVENTS">
                    <ol className="cj-timeline">
                      {data.audit.map((event) => (
                        <li key={event.id}>
                          <span className="cj-timeline-dot" />
                          <div>
                            <strong>{readable(event.action)}</strong>
                            <small>
                              {time(event.createdAt)}
                              {event.actorName ? ` · ${event.actorName}` : ""}
                            </small>
                            {event.details && <p>{event.details}</p>}
                          </div>
                        </li>
                      ))}
                    </ol>
                    {!data.audit.length && (
                      <Empty>No activity is available in this workspace.</Empty>
                    )}
                  </Card>
                )}
              </>
            ) : (
              !busy && (
                <Card
                  title={role === "insurer" ? "No consented claims yet" : "No encounter available"}
                >
                  <Empty>
                    {role === "insurer"
                      ? "The hospital must submit a claim for your medical-aid scheme before it appears here."
                      : role === "paramedic"
                        ? "Admissions must assign an ambulance encounter to your crew."
                        : "Admissions can register a patient and open an encounter below."}
                  </Empty>
                </Card>
              )
            )}
            {role === "admin" && tab === "overview" && (
              <div className="cj-two-columns">
                <Card title="Open a patient encounter" eyebrow="AMBULANCE INTAKE">
                  <form
                    onSubmit={(event) => {
                      const values = formValues(event);
                      void act(
                        { action: "createEncounter", ...values },
                        "Patient encounter opened."
                      );
                    }}
                  >
                    <Field label="Patient">
                      <select name="patientId" required defaultValue="">
                        <option value="" disabled>
                          Select registered patient
                        </option>
                        {data?.patients.map((item) => (
                          <option value={item.id} key={item.id}>
                            {item.fullName} · {item.facilityFileNumber.slice(0, 18)}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Assigned ambulance crew">
                      <select name="crewUserId" required defaultValue="">
                        <option value="" disabled>
                          Select a crew
                        </option>
                        {data?.crew.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Reason for care">
                      <input name="chiefComplaint" required maxLength={1000} />
                    </Field>
                    <Field label="Pickup / referral location">
                      <input name="location" required maxLength={300} />
                    </Field>
                    <Field label="Triage priority">
                      <select name="triage">
                        <option>Yellow</option>
                        <option>Green</option>
                        <option>Orange</option>
                        <option>Red</option>
                      </select>
                    </Field>
                    <button className="cj-button" type="submit">
                      Open encounter
                    </button>
                  </form>
                </Card>
                <Card title="Register a fictional patient" eyebrow="ADMISSIONS">
                  <form
                    onSubmit={(event) => {
                      const values = formValues(event);
                      void act(
                        {
                          action: "registerPatient",
                          ...values,
                          popiaConsent: values.popiaConsent === "on",
                          consentDataSharing: values.consentDataSharing === "on",
                          consentTreatment: values.consentTreatment === "on"
                        },
                        "Patient registered. Select them when opening an encounter. Login enrolment is a separate process."
                      );
                    }}
                    className="cj-form-grid"
                  >
                    <Field label="Full name">
                      <input name="fullName" required maxLength={160} />
                    </Field>
                    <Field label="Date of birth">
                      <input name="dateOfBirth" type="date" required />
                    </Field>
                    <Field label="Fictional identity number">
                      <input name="saId" maxLength={20} />
                    </Field>
                    <Field label="Fictional passport">
                      <input name="passportNumber" maxLength={30} />
                    </Field>
                    <Field label="Email">
                      <input name="email" type="email" required maxLength={200} />
                    </Field>
                    <Field label="Phone">
                      <input name="phone" type="tel" required maxLength={40} />
                    </Field>
                    <Field label="Medical-aid scheme">
                      <select name="medicalAidScheme">
                        <option>Discovery Health Medical Scheme</option>
                        <option>Momentum Medical Scheme</option>
                        <option>Bonitas Medical Fund</option>
                        <option>Self-pay / cash patient</option>
                      </select>
                    </Field>
                    <Field label="Fictional membership number">
                      <input name="medicalAidNumber" maxLength={80} />
                    </Field>
                    <div className="cj-span-full">
                      <label className="cj-checkbox">
                        <input type="checkbox" name="popiaConsent" />
                        Privacy acknowledgement recorded
                      </label>
                      <label className="cj-checkbox">
                        <input type="checkbox" name="consentTreatment" />
                        Treatment consent recorded
                      </label>
                      <label className="cj-checkbox">
                        <input type="checkbox" name="consentDataSharing" />
                        Medical-aid information sharing recorded
                      </label>
                      <button className="cj-button cj-button-secondary" type="submit">
                        Register patient
                      </button>
                    </div>
                  </form>
                </Card>
              </div>
            )}
          </fieldset>
          <footer className="cj-footer">
            UbuntuCare SA · Fictional-data prototype · All times shown in South African Standard
            Time
          </footer>
        </div>
      </div>
    </main>
  );
}
