"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { PortalActor, PortalContext, PortalRequest, PortalRun } from "@/lib/portal-types";
import { DocumentsPanel } from "./documents-panel";
import { MessagesPanel } from "./messages-panel";
import { AppointmentsPanel } from "./appointments-panel";
import { WorklistsPanel } from "./worklists-panel";
import { AssistantPanel } from "./assistant-panel";
import { Badge, Empty, Field, formatTime, readable } from "./shared-ui";

export function CoordinationPortal({ initialSession }: { initialSession: PortalActor }) {
  const router = useRouter();
  const [data, setData] = useState<PortalContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [mutating, setMutating] = useState(false);
  const [childBusy, setChildBusy] = useState(false);
  const [tab, setTab] = useState("messages");
  const [draftKey, setDraftKey] = useState(0);
  const [notice, setNotice] = useState<{ error: boolean; text: string } | null>(null);
  const selected = useRef("");
  const sequence = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const mutation = useRef(false);
  const role = initialSession.role;
  const hospital = ["admin", "doctor", "nurse"].includes(role);
  const appointments = hospital || role === "patient";
  const concerns = hospital || ["patient", "referring_doctor", "billing"].includes(role);
  const departments = hospital || role === "billing";
  const busy = loading || mutating || childBusy;

  async function load(id = selected.current) {
    const token = ++sequence.current;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setLoading(true);
    try {
      const response = await fetch(
        `/api/portal${id ? `?encounterId=${encodeURIComponent(id)}` : ""}`,
        { cache: "no-store", signal: abort.signal }
      );
      const result = await response.json();
      if (token !== sequence.current) return;
      if (!response.ok || !result.ok)
        throw new Error(result.message || "The coordination workspace could not be loaded.");
      selected.current = result.activeEncounter?.id ?? "";
      setData(result);
    } catch (error) {
      if (abort.signal.aborted || token !== sequence.current) return;
      setNotice({
        error: true,
        text: error instanceof Error ? error.message : "Unable to load this workspace."
      });
    } finally {
      if (token === sequence.current) setLoading(false);
    }
  }

  useEffect(() => {
    const initialId = new URL(window.location.href).searchParams.get("encounterId") ?? "";
    selected.current = initialId;
    void load(initialId);
    return () => {
      sequence.current++;
      controller.current?.abort();
    };
    // The server authenticates this session before rendering the workspace.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const request: PortalRequest = async (endpoint, body, success = "Saved successfully.") => {
    if (mutation.current || loading || childBusy) return null;
    mutation.current = true;
    setMutating(true);
    setNotice(null);
    const encounterId = selected.current;
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        ...(body instanceof FormData
          ? { body }
          : {
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ encounterId, ...body })
            })
      });
      const result = await response.json();
      if (!response.ok || !result.ok)
        throw new Error(result.message || "This action could not be saved.");
      if (selected.current !== encounterId) return null;
      setNotice({ error: false, text: success });
      await load(encounterId);
      return result;
    } catch (error) {
      setNotice({
        error: true,
        text: error instanceof Error ? error.message : "This action could not be saved."
      });
      return null;
    } finally {
      mutation.current = false;
      setMutating(false);
    }
  };
  const run: PortalRun = (action, body = {}, success) =>
    request("/api/portal/actions", { action, ...body }, success);

  function switchEncounter(id: string) {
    if (busy || mutation.current || selected.current === id) return;
    selected.current = id;
    setData(null);
    setNotice(null);
    setDraftKey((key) => key + 1);
    void load(id);
  }

  const active = data?.activeEncounter;
  const actor = data?.session ?? initialSession;
  const unread = data?.notifications.filter((item) => !item.readAt).length ?? 0;
  const tabs = [
    { id: "messages", label: "Messages", mark: "01" },
    { id: "documents", label: "Documents", mark: "02" },
    ...(appointments ? [{ id: "appointments", label: "Appointments", mark: "03" }] : []),
    ...(concerns
      ? [
          {
            id: "concerns",
            label: role === "referring_doctor" ? "Prior records" : "Concerns & records",
            mark: "04"
          }
        ]
      : []),
    ...(departments ? [{ id: "departments", label: "Departments", mark: "05" }] : []),
    { id: "assistant", label: "Workflow assistant", mark: "06" }
  ];
  function navigateTab(value: string) {
    const aliases: Record<string, string> = {
      records: "concerns",
      worklists: "concerns",
      tasks: "departments",
      checks: "assistant",
      chat: "messages"
    };
    const next = aliases[value] ?? value;
    if (!busy && tabs.some((item) => item.id === next)) setTab(next);
  }

  return (
    <main className="pp-app">
      <header className="pp-topbar">
        <a className="pp-brand" href="/journey">
          <span className="pp-logo" aria-hidden="true">
            +
          </span>
          <span>
            UbuntuCare<small>PRIVATE HOSPITAL · SOUTH AFRICA</small>
          </span>
        </a>
        <div className="pp-user">
          <div>
            <strong>{actor.name}</strong>
            <small>
              {readable(actor.role)}
              {actor.organization ? ` · ${actor.organization}` : ""}
            </small>
          </div>
          <a href="/journey" className="pp-link-button">
            Care journey
          </a>
          <button
            type="button"
            className="pp-subtle"
            disabled={busy}
            onClick={async () => {
              await fetch("/api/auth/logout", { method: "POST" });
              router.push("/login");
              router.refresh();
            }}
          >
            Sign out
          </button>
        </div>
      </header>
      <div className="pp-demo">
        <strong>FICTIONAL DEMO</strong>
        <span>
          One private hospital. In-app records and conversations persist. External email, providers
          and scheme connections are simulated.
        </span>
      </div>
      <div className="pp-layout">
        <aside className="pp-sidebar">
          <div>
            <span className="pp-eyebrow">CONNECTED CARE</span>
            <h1>
              Hospital
              <br />
              coordination
            </h1>
            <p>One place for the next step.</p>
          </div>
          <nav aria-label="Coordination sections">
            {tabs.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-current={tab === item.id ? "page" : undefined}
                className={tab === item.id ? "pp-nav-active" : ""}
                disabled={busy}
                onClick={() => {
                  setTab(item.id);
                  setNotice(null);
                }}
              >
                <span aria-hidden="true">{item.mark}</span>
                {item.label}
              </button>
            ))}
          </nav>
          <div className="pp-sidebar-note">
            <strong>Your information, in context</strong>
            <p>Access follows your role, encounter and active sharing permissions.</p>
            <a href="/journey">Open clinical care journey →</a>
          </div>
        </aside>
        <div className="pp-main">
          <div className="pp-page-heading">
            <div>
              <span className="pp-eyebrow">PAPERLESS WORKSPACE</span>
              <h2>{tabs.find((item) => item.id === tab)?.label}</h2>
              <p>Keep conversations, records and responsibilities connected.</p>
            </div>
            <div className="pp-context">
              <Field label="Patient encounter">
                <select
                  aria-label="Patient encounter"
                  value={active?.id ?? selected.current}
                  disabled={busy || !data?.encounters.length}
                  onChange={(event) => switchEncounter(event.target.value)}
                >
                  {!data?.encounters.length && <option value="">No accessible encounter</option>}
                  {data?.encounters.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.patient.fullName} · {item.reference}
                    </option>
                  ))}
                </select>
              </Field>
              <button
                type="button"
                className="pp-subtle"
                disabled={busy}
                onClick={() => void load()}
              >
                Refresh
              </button>
            </div>
          </div>
          {notice && (
            <div
              role={notice.error ? "alert" : "status"}
              className={`pp-notice ${notice.error ? "pp-error" : "pp-success"}`}
            >
              {notice.text}
            </div>
          )}
          {loading && (
            <p className="pp-loading" role="status">
              Loading authorised workspace…
            </p>
          )}
          {!loading && !data && (
            <div className="pp-card">
              <Empty>The workspace is unavailable. Refresh to try again.</Empty>
              <button type="button" onClick={() => void load()}>
                Try again
              </button>
            </div>
          )}
          {data && (
            <>
              <div className="pp-encounter-strip">
                <div>
                  <span className="pp-avatar" aria-hidden="true">
                    {active?.patient.fullName.slice(0, 1) ?? "—"}
                  </span>
                  <div>
                    <strong>{active?.patient.fullName ?? "No patient selected"}</strong>
                    <small>
                      {active
                        ? `${active.reference} · ${active.patient.facilityFileNumber}`
                        : "Your accessible cases appear here."}
                    </small>
                  </div>
                </div>
                {active && <Badge value={active.status} />}
                <span className="pp-strip-note">All times South African Standard Time</span>
              </div>
              {unread > 0 && (
                <details className="pp-notifications">
                  <summary>
                    {unread} unread notification{unread === 1 ? "" : "s"}
                  </summary>
                  <ul>
                    {data.notifications
                      .filter((item) => !item.readAt)
                      .slice(0, 8)
                      .map((item) => (
                        <li key={item.id}>
                          <div>
                            <strong>{item.title}</strong>
                            <p>{item.body}</p>
                            <small>{formatTime(item.createdAt)}</small>
                          </div>
                          <button
                            type="button"
                            className="pp-subtle"
                            disabled={busy}
                            onClick={() =>
                              void run(
                                "markNotification",
                                { notificationId: item.id },
                                "Notification marked as read."
                              )
                            }
                          >
                            Mark read
                          </button>
                        </li>
                      ))}
                  </ul>
                </details>
              )}
              {active ? (
                <fieldset
                  className="pp-workspace"
                  disabled={loading || mutating}
                  key={`${active.id}-${draftKey}`}
                  aria-busy={loading || mutating}
                >
                  {tab === "messages" && (
                    <MessagesPanel
                      encounterId={active.id}
                      actor={actor}
                      contacts={data.contacts}
                      claims={data.claims ?? []}
                      recordRequests={data.recordRequests}
                      request={request}
                      busy={busy}
                    />
                  )}
                  {tab === "documents" && (
                    <DocumentsPanel
                      encounterId={active.id}
                      actor={actor}
                      claims={data.claims ?? []}
                      recordRequests={data.recordRequests}
                      request={request}
                      busy={busy}
                    />
                  )}
                  {tab === "appointments" && (
                    <AppointmentsPanel
                      encounterId={active.id}
                      actor={actor}
                      onBusyChange={setChildBusy}
                    />
                  )}
                  {(tab === "concerns" || tab === "departments") && (
                    <WorklistsPanel
                      data={data}
                      actor={actor}
                      run={run}
                      busy={busy}
                      view={tab}
                      navigate={navigateTab}
                    />
                  )}
                  {tab === "assistant" && (
                    <AssistantPanel
                      data={data}
                      actor={actor}
                      run={run}
                      busy={busy}
                      navigate={navigateTab}
                    />
                  )}
                </fieldset>
              ) : (
                <div className="pp-card">
                  <Empty>
                    No encounter is currently shared with your account. Ask the hospital team to
                    check your assignment.
                  </Empty>
                </div>
              )}
              {data.outbox.length > 0 && (
                <details className="pp-outbox">
                  <summary>Simulated email activity · {data.outbox.length}</summary>
                  <p>
                    No email leaves this demo. Copies contain a generic notification to sign in.
                  </p>
                  <ul>
                    {data.outbox.slice(0, 6).map((item) => (
                      <li key={item.id}>
                        <span>
                          <strong>{item.subject}</strong>
                          <small>
                            {item.recipientEmail ? `${item.recipientEmail} · ` : ""}
                            {formatTime(item.createdAt)}
                          </small>
                        </span>
                        <Badge value={item.status} />
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </>
          )}
          <footer className="pp-footer">
            UbuntuCare demo · Coordination supports the hospital team. For a medical emergency in
            South Africa call 112 from a mobile or 10177 for an ambulance.
          </footer>
        </div>
      </div>
    </main>
  );
}
