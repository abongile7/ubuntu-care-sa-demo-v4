"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Badge, Card, Empty, Field, formatTime, readable } from "./shared-ui";

type Contact = { id: string; name: string; role: string; organization?: string | null };
type Concern = {
  id: string;
  category: string;
  body: string;
  urgency: string;
  status: string;
  version: number;
  createdAt: string;
  assignedUserId?: string | null;
  assignedName?: string | null;
  updates?: {
    id: string;
    authorName: string;
    authorRole: string;
    body: string;
    status: string;
    createdAt: string;
  }[];
};
type RecordRequest = {
  id: string;
  reference: string;
  providerName: string;
  providerEmail: string;
  providerUserId?: string | null;
  purpose: string;
  scope: string;
  consentRecordedAt: string;
  expiresAt: string;
  status: string;
  version: number;
  createdAt: string;
  fulfilledVersionId?: string | null;
  fulfilledDocumentTitle?: string | null;
};
type Task = {
  id: string;
  department: string;
  title: string;
  priority: string;
  status: string;
  version: number;
  assignedUserId: string;
  assigneeName?: string | null;
  dueAt?: string | null;
  createdAt: string;
};
type Department =
  | string
  | { id?: string; key?: string; name?: string; label?: string; code?: string };
export type WorklistData = {
  activeEncounter?: { id: string } | null;
  contacts?: Contact[];
  externalProviders?: { id: string; name: string; organization?: string; email: string }[];
  departments?: Department[];
  concerns?: Concern[];
  recordRequests?: RecordRequest[];
  tasks?: Task[];
};
type Actor = { id: string; name?: string; role: string };
type Run = (action: string, body: Record<string, unknown>, success?: string) => Promise<unknown>;
type PanelProps = {
  data: WorklistData;
  actor: Actor;
  run: Run;
  busy: boolean;
  navigate?: (tab: string) => void;
};
type PublishedVersion = { id: string; title: string; version: number; requestId: string };

function values(event: FormEvent<HTMLFormElement>) {
  event.preventDefault();
  return Object.fromEntries(new FormData(event.currentTarget).entries()) as Record<string, string>;
}
function staffContacts(contacts: Contact[]) {
  return contacts.filter((contact) =>
    ["admin", "doctor", "nurse", "billing"].includes(contact.role)
  );
}
function departmentValue(department: Department) {
  if (typeof department === "string") return department;
  return (
    department.key || department.code || department.id || department.name || department.label || ""
  );
}
function departmentLabel(department: Department) {
  if (typeof department === "string") return readable(department);
  return department.label || department.name || readable(departmentValue(department));
}

export function WorklistsPanel({
  data,
  actor,
  run,
  busy,
  navigate,
  view = "concerns"
}: PanelProps & { view?: "concerns" | "departments" }) {
  if (view === "departments")
    return <DepartmentsPanel data={data} actor={actor} run={run} busy={busy} />;
  return (
    <div className="pp-stack">
      <ConcernsPanel data={data} actor={actor} run={run} busy={busy} />
      <RecordRequestsPanel data={data} actor={actor} run={run} busy={busy} navigate={navigate} />
    </div>
  );
}

function ConcernsPanel({ data, actor, run, busy }: PanelProps) {
  const hospital = ["admin", "doctor", "nurse"].includes(actor.role);
  const mayRespond = hospital || actor.role === "billing";
  if (!mayRespond && actor.role !== "patient") return null;
  const concerns = data.concerns || [];
  const contacts = staffContacts(data.contacts || []).filter(
    (contact) => actor.role === "billing" || contact.role !== "billing"
  );
  return (
    <Card title="Patient concerns" eyebrow="A conversation with your care team">
      <p className="pp-muted">
        Share a question or concern with the hospital. Your care team reviews this queue; replies
        are saved below.
      </p>
      <div className="pp-warning" role="note">
        This inbox is not monitored as an emergency service. In an emergency in South Africa, call
        112 from a mobile or 10177 for an ambulance, or alert hospital staff immediately.
      </div>
      {(hospital || actor.role === "patient") && (
        <details className="pp-details">
          <summary>Raise a concern</summary>
          <form
            className="pp-form"
            onSubmit={async (event) => {
              const form = event.currentTarget;
              const input = values(event);
              const result = await run(
                "createConcern",
                {
                  encounterId: data.activeEncounter?.id,
                  category: input.category,
                  body: input.body,
                  urgency: input.urgency
                },
                "Concern sent to the hospital queue."
              );
              if (result) form.reset();
            }}
          >
            <div className="pp-form-grid">
              <Field label="Concern category">
                <select name="category" required disabled={busy}>
                  <option value="CARE_QUESTION">Care question</option>
                  <option value="MEDICATION">Medication question</option>
                  <option value="ADMINISTRATION">Administration</option>
                  <option value="DISCHARGE">Discharge planning</option>
                  <option value="BILLING">Billing question</option>
                  <option value="OTHER">Other</option>
                </select>
              </Field>
              <Field label="Priority">
                <select name="urgency" disabled={busy}>
                  <option value="NORMAL">Normal</option>
                  <option value="URGENT">Urgent — needs human review</option>
                </select>
              </Field>
            </div>
            <Field label="Your concern">
              <textarea
                name="body"
                required
                minLength={3}
                maxLength={4000}
                rows={3}
                disabled={busy}
                placeholder="Tell your care team what you need help with."
              />
            </Field>
            <button className="pp-button" disabled={busy || !data.activeEncounter}>
              Send concern
            </button>
          </form>
        </details>
      )}
      {!concerns.length && <Empty>No concerns have been raised for this encounter.</Empty>}
      <div className="pp-stack">
        {concerns.map((concern) => (
          <article className="pp-record" key={concern.id}>
            <div className="pp-row pp-row-between">
              <div>
                <strong>{readable(concern.category)}</strong>
                <p className="pp-meta">Raised {formatTime(concern.createdAt)}</p>
              </div>
              <div className="pp-badges">
                <Badge value={concern.status} />
                {concern.urgency === "URGENT" && <Badge value="URGENT" />}
              </div>
            </div>
            <p className="pp-preserve">{concern.body}</p>
            {concern.assignedUserId && (
              <p className="pp-meta">
                Assigned to{" "}
                {concern.assignedName ||
                  contacts.find((contact) => contact.id === concern.assignedUserId)?.name ||
                  "hospital care team"}
              </p>
            )}
            {!!concern.updates?.length && (
              <ol className="pp-timeline" aria-label="Concern responses">
                {concern.updates.map((update) => (
                  <li key={update.id}>
                    <div className="pp-row pp-row-between">
                      <strong>{update.authorName}</strong>
                      <span className="pp-meta">{formatTime(update.createdAt)}</span>
                    </div>
                    <p className="pp-preserve">{update.body}</p>
                    <span className="pp-meta">
                      {readable(update.authorRole)} · {readable(update.status)}
                    </span>
                  </li>
                ))}
              </ol>
            )}
            {mayRespond && concern.status !== "RESOLVED" && (
              <details className="pp-details">
                <summary>Respond or assign</summary>
                <form
                  className="pp-form"
                  onSubmit={async (event) => {
                    const form = event.currentTarget;
                    const input = values(event);
                    const result = await run(
                      input.action,
                      {
                        concernId: concern.id,
                        version: concern.version,
                        assignedUserId: input.assignedUserId || undefined,
                        body: input.body
                      },
                      "Concern updated."
                    );
                    if (result) form.reset();
                  }}
                >
                  <div className="pp-form-grid">
                    <Field label="Concern action">
                      <select name="action" disabled={busy}>
                        <option value="respondConcern">Respond</option>
                        <option value="assignConcern">Assign to staff</option>
                        <option value="resolveConcern">Resolve with response</option>
                      </select>
                    </Field>
                    <Field label="Assigned staff member">
                      <select
                        name="assignedUserId"
                        defaultValue={concern.assignedUserId || ""}
                        disabled={busy}
                      >
                        <option value="">Keep current assignment</option>
                        {contacts.map((contact) => (
                          <option value={contact.id} key={contact.id}>
                            {contact.name} · {readable(contact.role)}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>
                  <Field label="Response to the patient">
                    <textarea
                      name="body"
                      required
                      minLength={3}
                      maxLength={4000}
                      rows={3}
                      disabled={busy}
                    />
                  </Field>
                  <button className="pp-button" disabled={busy}>
                    Save concern update
                  </button>
                </form>
              </details>
            )}
            {concern.status === "RESOLVED" && (
              <details className="pp-details">
                <summary>Reopen this concern</summary>
                <form
                  className="pp-form"
                  onSubmit={async (event) => {
                    const form = event.currentTarget;
                    const input = values(event);
                    const result = await run(
                      "reopenConcern",
                      { concernId: concern.id, version: concern.version, body: input.body },
                      "Concern reopened for the hospital team."
                    );
                    if (result) form.reset();
                  }}
                >
                  <Field label="Why the concern needs more attention">
                    <textarea
                      name="body"
                      required
                      minLength={3}
                      maxLength={4000}
                      rows={3}
                      disabled={busy}
                    />
                  </Field>
                  <button className="pp-button pp-secondary" disabled={busy}>
                    Reopen concern
                  </button>
                </form>
              </details>
            )}
          </article>
        ))}
      </div>
    </Card>
  );
}

function RecordRequestsPanel({ data, actor, run, busy, navigate }: PanelProps) {
  const encounterId = data.activeEncounter?.id;
  const hospital = ["admin", "doctor", "nurse"].includes(actor.role);
  const mayRequest = hospital || actor.role === "patient";
  const requests = data.recordRequests || [];
  const [published, setPublished] = useState<PublishedVersion[]>([]);
  const [documentError, setDocumentError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [documentsLoading, setDocumentsLoading] = useState(false);
  useEffect(() => {
    if (!encounterId || !(hospital || actor.role === "referring_doctor")) return;
    const controller = new AbortController();
    setPublished([]);
    setDocumentError("");
    setDocumentsLoading(true);
    void fetch(`/api/portal/documents?encounterId=${encodeURIComponent(encounterId)}`, {
      signal: controller.signal,
      cache: "no-store"
    })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok)
          throw new Error(result.message || "Unable to load published records documents.");
        if (controller.signal.aborted) return;
        const options: PublishedVersion[] = [];
        for (const document of result.documents || []) {
          if (document.visibility !== "RECORD_REQUEST" || !document.recordRequestId) continue;
          for (const version of document.versions || [])
            if (version.status === "PUBLISHED")
              options.push({
                id: version.id,
                title: version.title,
                version: version.version,
                requestId: document.recordRequestId
              });
        }
        setPublished(options);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setDocumentError(
            error instanceof Error ? error.message : "Unable to load records documents."
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setDocumentsLoading(false);
      });
    return () => controller.abort();
  }, [encounterId, hospital, actor.role, refreshKey]);
  if (!mayRequest && actor.role !== "referring_doctor") return null;
  const providers = data.externalProviders || [];
  return (
    <Card title="Previous records" eyebrow="Consent and a traceable handover">
      <p className="pp-muted">
        Request a defined set of records from a previous provider. Consent and access expiry are
        recorded. External email is simulated; assigned providers can share documents through this
        portal.
      </p>
      {mayRequest && (
        <details className="pp-details">
          <summary>Request previous records</summary>
          <form
            className="pp-form"
            onSubmit={async (event) => {
              const form = event.currentTarget;
              const input = values(event);
              const result = await run(
                "requestRecords",
                {
                  encounterId,
                  providerName: input.providerName,
                  providerEmail: input.providerEmail,
                  providerUserId: input.providerUserId || undefined,
                  purpose: input.purpose,
                  scope: input.scope,
                  consentConfirmed: input.consentConfirmed === "on"
                },
                "Records request created with consent recorded."
              );
              if (result) form.reset();
            }}
          >
            <Field label="Assign a connected referring doctor (optional)">
              <select
                name="providerUserId"
                disabled={busy}
                onChange={(event) => {
                  const provider = providers.find(
                    (candidate) => candidate.id === event.target.value
                  );
                  if (!provider) return;
                  const form = event.currentTarget.form;
                  const name = form?.elements.namedItem("providerName");
                  const email = form?.elements.namedItem("providerEmail");
                  if (name instanceof HTMLInputElement) name.value = provider.name;
                  if (email instanceof HTMLInputElement) email.value = provider.email;
                }}
              >
                <option value="">No connected provider assigned</option>
                {providers.map((contact) => (
                  <option value={contact.id} key={contact.id}>
                    {contact.name}
                    {contact.organization ? ` · ${contact.organization}` : ""}
                  </option>
                ))}
              </select>
            </Field>
            <div className="pp-form-grid">
              <Field label="Previous provider name">
                <input
                  name="providerName"
                  required
                  maxLength={160}
                  disabled={busy}
                  autoComplete="organization"
                />
              </Field>
              <Field label="Provider email — simulated delivery">
                <input
                  type="email"
                  name="providerEmail"
                  required
                  maxLength={254}
                  disabled={busy}
                  autoComplete="email"
                />
              </Field>
            </div>
            <Field label="Purpose of request">
              <input
                name="purpose"
                required
                minLength={3}
                maxLength={1000}
                disabled={busy}
                placeholder="For example, continuity of care for this admission"
              />
            </Field>
            <Field label="Records in scope">
              <textarea
                name="scope"
                required
                minLength={3}
                maxLength={2000}
                rows={3}
                disabled={busy}
                placeholder="Specify the records needed and relevant date range."
              />
            </Field>
            <label className="pp-check">
              <input type="checkbox" name="consentConfirmed" required disabled={busy} />
              <span>
                {actor.role === "patient"
                  ? "I consent to this request and sharing the specified records for this encounter."
                  : "The patient has consented to this request and sharing the specified records for this encounter."}
              </span>
            </label>
            <button className="pp-button" disabled={busy || !encounterId}>
              Create records request
            </button>
          </form>
        </details>
      )}
      {!requests.length && <Empty>No prior-records requests for this encounter.</Empty>}
      {documentError && (
        <p className="pp-error" role="alert">
          {documentError}
        </p>
      )}
      <div className="pp-stack">
        {requests.map((request) => {
          const expired = new Date(request.expiresAt).getTime() <= Date.now();
          const closed = ["CANCELLED", "REVIEWED"].includes(request.status);
          const requestVersions = published.filter((version) => version.requestId === request.id);
          const mayFulfil =
            !closed &&
            !expired &&
            (hospital ||
              (actor.role === "referring_doctor" && request.providerUserId === actor.id));
          return (
            <article className="pp-record" key={request.id}>
              <div className="pp-row pp-row-between">
                <div>
                  <strong>{request.providerName}</strong>
                  <p className="pp-meta">
                    {request.reference} · {request.providerEmail}
                  </p>
                </div>
                <div className="pp-badges">
                  <Badge value={request.status} />
                  {expired && <Badge value="EXPIRED" />}
                </div>
              </div>
              <p>
                <strong>Purpose:</strong> {request.purpose}
              </p>
              <p className="pp-preserve">
                <strong>Scope:</strong> {request.scope}
              </p>
              <p className="pp-meta">
                Consent recorded {formatTime(request.consentRecordedAt)} · Access expires{" "}
                {formatTime(request.expiresAt)}
              </p>
              {request.fulfilledVersionId && (
                <p>
                  <a
                    className="pp-inline-link"
                    href={`/api/portal/documents/${encodeURIComponent(request.fulfilledVersionId)}/print`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View received records
                    {request.fulfilledDocumentTitle
                      ? `: ${request.fulfilledDocumentTitle}`
                      : " version"}{" "}
                    ↗
                  </a>
                </p>
              )}
              <div className="pp-row pp-actions">
                {hospital && request.status === "REQUESTED" && !expired && (
                  <button
                    className="pp-button pp-secondary"
                    disabled={busy}
                    onClick={() =>
                      void run(
                        "simulateRecordRequest",
                        { requestId: request.id, version: request.version },
                        "Generic request email queued in the simulated outbox."
                      )
                    }
                  >
                    Queue simulated request email
                  </button>
                )}
                {actor.role === "doctor" && request.status === "RECEIVED" && !expired && (
                  <button
                    className="pp-button"
                    disabled={busy}
                    onClick={() =>
                      void run(
                        "reviewRecordRequest",
                        { requestId: request.id, version: request.version },
                        "Previous records marked reviewed by the doctor."
                      )
                    }
                  >
                    Mark records reviewed
                  </button>
                )}
                {mayRequest && request.status !== "CANCELLED" && (
                  <button
                    className="pp-button pp-quiet"
                    disabled={busy}
                    onClick={() =>
                      void run(
                        "cancelRecordRequest",
                        { requestId: request.id, version: request.version },
                        "Records request cancelled; provider access revoked."
                      )
                    }
                  >
                    Cancel and revoke access
                  </button>
                )}
              </div>
              {mayFulfil && request.status !== "RECEIVED" && (
                <details className="pp-details">
                  <summary>Fulfil with a published records document</summary>
                  <p className="pp-muted">
                    Create a records-request document in Documents, attach the relevant files, then
                    publish it. The request can be fulfilled with that exact published version.
                  </p>
                  {navigate && (
                    <button
                      type="button"
                      className="pp-button pp-secondary"
                      disabled={busy}
                      onClick={() => navigate("documents")}
                    >
                      Open Documents
                    </button>
                  )}
                  <form
                    className="pp-form"
                    onSubmit={async (event) => {
                      const input = values(event);
                      await run(
                        "fulfilRecordRequest",
                        {
                          requestId: request.id,
                          version: request.version,
                          versionId: input.versionId
                        },
                        "Published records linked to the request for clinical review."
                      );
                    }}
                  >
                    <Field label="Published records version">
                      <select
                        name="versionId"
                        required
                        disabled={busy || documentsLoading || !requestVersions.length}
                      >
                        <option value="">
                          {documentsLoading
                            ? "Loading published documents…"
                            : requestVersions.length
                              ? "Select published version"
                              : "No published document for this request yet"}
                        </option>
                        {requestVersions.map((version) => (
                          <option value={version.id} key={version.id}>
                            {version.title} · version {version.version}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <div className="pp-row pp-actions">
                      <button
                        className="pp-button"
                        disabled={busy || documentsLoading || !requestVersions.length}
                      >
                        Fulfil records request
                      </button>
                      <button
                        type="button"
                        className="pp-button pp-secondary"
                        disabled={busy || documentsLoading}
                        onClick={() => setRefreshKey((key) => key + 1)}
                      >
                        Refresh document choices
                      </button>
                    </div>
                  </form>
                </details>
              )}
            </article>
          );
        })}
      </div>
    </Card>
  );
}

export function DepartmentsPanel({ data, actor, run, busy }: PanelProps) {
  const [departmentFilter, setDepartmentFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("active");
  const allowed = ["admin", "doctor", "nurse", "billing"].includes(actor.role);
  const tasks = data.tasks || [];
  const departments = data.departments || [];
  const contacts = staffContacts(data.contacts || []);
  const visible = tasks.filter(
    (task) =>
      (!departmentFilter || task.department === departmentFilter) &&
      (statusFilter === "all" || !["DONE", "CANCELLED"].includes(task.status))
  );
  if (!allowed)
    return (
      <Card title="Department work queues">
        <Empty>Department work queues are available to authorised hospital staff.</Empty>
      </Card>
    );
  return (
    <Card title="Department work queues" eyebrow="Clear ownership across the hospital">
      <p className="pp-muted">
        Coordinate operational work with a department, responsible staff member and explicit status.
        These queues do not place clinical orders.
      </p>
      <div className="pp-stat-row">
        <div className="pp-mini-stat">
          <strong>
            {tasks.filter((task) => !["DONE", "CANCELLED"].includes(task.status)).length}
          </strong>
          <span>active tasks</span>
        </div>
        <div className="pp-mini-stat">
          <strong>
            {
              tasks.filter(
                (task) => task.priority === "URGENT" && !["DONE", "CANCELLED"].includes(task.status)
              ).length
            }
          </strong>
          <span>urgent tasks</span>
        </div>
        <div className="pp-mini-stat">
          <strong>{new Set(tasks.map((task) => task.department)).size}</strong>
          <span>departments with work</span>
        </div>
      </div>
      <details className="pp-details">
        <summary>Create a department task</summary>
        <form
          className="pp-form"
          onSubmit={async (event) => {
            const form = event.currentTarget;
            const input = values(event);
            const result = await run(
              "createTask",
              {
                encounterId: data.activeEncounter?.id,
                title: input.title,
                department: input.department,
                priority: input.priority,
                assignedUserId: input.assignedUserId,
                dueAt: input.dueAt ? new Date(input.dueAt).toISOString() : undefined
              },
              "Department task created."
            );
            if (result) form.reset();
          }}
        >
          <Field label="Task title">
            <input name="title" required minLength={3} maxLength={240} disabled={busy} />
          </Field>
          <div className="pp-form-grid">
            <Field label="Department">
              <select name="department" required disabled={busy}>
                <option value="">Select department</option>
                {departments.map((department) => (
                  <option value={departmentValue(department)} key={departmentValue(department)}>
                    {departmentLabel(department)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Priority">
              <select name="priority" disabled={busy}>
                <option value="NORMAL">Normal</option>
                <option value="URGENT">Urgent</option>
              </select>
            </Field>
            <Field label="Assigned staff">
              <select name="assignedUserId" required disabled={busy}>
                <option value="">Select staff member</option>
                {contacts.map((contact) => (
                  <option value={contact.id} key={contact.id}>
                    {contact.name} · {readable(contact.role)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Due date and time (your local time, optional)">
              <input type="datetime-local" name="dueAt" disabled={busy} />
            </Field>
          </div>
          <button className="pp-button" disabled={busy || !data.activeEncounter}>
            Create task
          </button>
        </form>
      </details>
      <div className="pp-form-grid pp-filter-row">
        <Field label="Filter by department">
          <select
            value={departmentFilter}
            onChange={(event) => setDepartmentFilter(event.target.value)}
          >
            <option value="">All departments</option>
            {departments.map((department) => (
              <option value={departmentValue(department)} key={departmentValue(department)}>
                {departmentLabel(department)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Task display">
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="active">Active tasks</option>
            <option value="all">All tasks</option>
          </select>
        </Field>
      </div>
      {!visible.length && <Empty>No tasks match this department view.</Empty>}
      <div className="pp-stack">
        {visible.map((task) => (
          <article className="pp-record" key={task.id}>
            <div className="pp-row pp-row-between">
              <div>
                <strong>{task.title}</strong>
                <p className="pp-meta">
                  {departmentLabel(
                    departments.find(
                      (department) => departmentValue(department) === task.department
                    ) || task.department
                  )}{" "}
                  ·{" "}
                  {task.assigneeName ||
                    contacts.find((contact) => contact.id === task.assignedUserId)?.name ||
                    "Hospital staff"}
                </p>
              </div>
              <div className="pp-badges">
                <Badge value={task.status} />
                {task.priority === "URGENT" && <Badge value="URGENT" />}
              </div>
            </div>
            {task.dueAt && <p className="pp-meta">Due {formatTime(task.dueAt)}</p>}
            <details className="pp-details">
              <summary>Update task</summary>
              <form
                className="pp-form"
                onSubmit={async (event) => {
                  const input = values(event);
                  await run(
                    "updateTask",
                    {
                      taskId: task.id,
                      version: task.version,
                      title: input.title,
                      department: input.department,
                      priority: input.priority,
                      status: input.status,
                      assignedUserId: input.assignedUserId,
                      dueAt: input.dueAt ? new Date(input.dueAt).toISOString() : null
                    },
                    "Department task updated."
                  );
                }}
              >
                <Field label="Task title">
                  <input
                    name="title"
                    required
                    minLength={3}
                    maxLength={240}
                    defaultValue={task.title}
                    disabled={busy}
                  />
                </Field>
                <div className="pp-form-grid">
                  <Field label="Department">
                    <select
                      name="department"
                      defaultValue={task.department}
                      required
                      disabled={busy}
                    >
                      {departments.map((department) => (
                        <option
                          value={departmentValue(department)}
                          key={departmentValue(department)}
                        >
                          {departmentLabel(department)}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Task status">
                    <select name="status" defaultValue={task.status} disabled={busy}>
                      <option value="OPEN">Open</option>
                      <option value="IN_PROGRESS">In progress</option>
                      <option value="BLOCKED">Blocked</option>
                      <option value="DONE">Done</option>
                      <option value="CANCELLED">Cancelled</option>
                    </select>
                  </Field>
                  <Field label="Priority">
                    <select name="priority" defaultValue={task.priority} disabled={busy}>
                      <option value="NORMAL">Normal</option>
                      <option value="URGENT">Urgent</option>
                    </select>
                  </Field>
                  <Field label="Assigned staff">
                    <select
                      name="assignedUserId"
                      defaultValue={task.assignedUserId}
                      required
                      disabled={busy}
                    >
                      {contacts.map((contact) => (
                        <option value={contact.id} key={contact.id}>
                          {contact.name} · {readable(contact.role)}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Due date and time (your local time, optional)">
                    <input
                      type="datetime-local"
                      name="dueAt"
                      defaultValue={
                        task.dueAt
                          ? new Date(
                              new Date(task.dueAt).getTime() -
                                new Date(task.dueAt).getTimezoneOffset() * 60000
                            )
                              .toISOString()
                              .slice(0, 16)
                          : ""
                      }
                      disabled={busy}
                    />
                  </Field>
                </div>
                <button className="pp-button" disabled={busy}>
                  Save task update
                </button>
              </form>
            </details>
          </article>
        ))}
      </div>
    </Card>
  );
}
