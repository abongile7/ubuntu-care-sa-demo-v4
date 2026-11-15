"use client";

import { useEffect, useRef, useState } from "react";
import type {
  PortalActor,
  PortalContact,
  PortalDocument,
  PortalFile,
  PortalRecordRequest,
  PortalRequest,
  PortalThread
} from "@/lib/portal-types";
import {
  Badge,
  Card,
  Empty,
  Field,
  FileLinks,
  formatTime,
  formValues,
  readable
} from "./shared-ui";

export function MessagesPanel({
  encounterId,
  actor,
  contacts,
  claims,
  recordRequests,
  request,
  busy
}: {
  encounterId: string;
  actor: PortalActor;
  contacts: PortalContact[];
  claims: { id: string; reference: string; status: string }[];
  recordRequests: PortalRecordRequest[];
  request: PortalRequest;
  busy: boolean;
}) {
  const [threads, setThreads] = useState<PortalThread[]>([]);
  const [threadId, setThreadId] = useState("");
  const [thread, setThread] = useState<PortalThread | null>(null);
  const [files, setFiles] = useState<(PortalFile & { documentTitle: string })[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");
  const [newThread, setNewThread] = useState(false);
  const [type, setType] = useState(
    actor.role === "insurer" || actor.role === "billing"
      ? "CLAIM"
      : actor.role === "paramedic"
        ? "HANDOVER"
        : actor.role === "referring_doctor"
          ? "RECORD_REQUEST"
          : "CARE"
  );
  const listController = useRef<AbortController | null>(null);
  const detailController = useRef<AbortController | null>(null);
  const listSequence = useRef(0);
  const detailSequence = useRef(0);
  const selected = useRef("");
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const hospital = ["admin", "doctor", "nurse"].includes(actor.role);
  const types = hospital
    ? ["CARE", "CLAIM", "HANDOVER", "RECORD_REQUEST"]
    : actor.role === "patient"
      ? ["CARE", "CLAIM", "RECORD_REQUEST"]
      : [type];
  const availableContacts = contacts.filter(
    (contact) =>
      contact.id !== actor.id &&
      (type === "CARE"
        ? ["patient", "doctor", "nurse", "admin"].includes(contact.role)
        : type === "HANDOVER"
          ? ["doctor", "nurse", "admin", "paramedic"].includes(contact.role)
          : type === "RECORD_REQUEST"
            ? ["patient", "doctor", "nurse", "admin", "referring_doctor"].includes(contact.role)
            : ["patient", "doctor", "nurse", "admin", "billing", "insurer"].includes(contact.role))
  );
  const liveRequests = recordRequests.filter(
    (item) => item.status !== "CANCELLED" && new Date(item.expiresAt).getTime() > Date.now()
  );

  async function loadThreads(preferId?: string) {
    listController.current?.abort();
    const abort = new AbortController();
    listController.current = abort;
    const token = ++listSequence.current;
    setLoading(true);
    setError("");
    try {
      const response = await fetch(
        `/api/portal/messages?encounterId=${encodeURIComponent(encounterId)}`,
        { cache: "no-store", signal: abort.signal }
      );
      const result = await response.json();
      if (token !== listSequence.current) return;
      if (!response.ok || !result.ok)
        throw new Error(result.message || "Conversations could not be loaded.");
      setThreads(result.threads);
      setThreadId((current) =>
        result.threads.some((item: PortalThread) => item.id === (preferId ?? current))
          ? (preferId ?? current)
          : (result.threads[0]?.id ?? "")
      );
    } catch (reason) {
      if (!abort.signal.aborted && token === listSequence.current)
        setError(reason instanceof Error ? reason.message : "Conversations could not be loaded.");
    } finally {
      if (token === listSequence.current) setLoading(false);
    }
  }

  async function loadThread(id: string, silent = false) {
    detailController.current?.abort();
    const abort = new AbortController();
    detailController.current = abort;
    const token = ++detailSequence.current;
    if (!silent) setDetailLoading(true);
    try {
      const response = await fetch(`/api/portal/messages?threadId=${encodeURIComponent(id)}`, {
        cache: "no-store",
        signal: abort.signal
      });
      const result = await response.json();
      if (token !== detailSequence.current || selected.current !== id) return;
      if (!response.ok || !result.ok)
        throw new Error(result.message || "This conversation is no longer accessible.");
      setThread(result.thread);
    } catch (reason) {
      if (!abort.signal.aborted && token === detailSequence.current) {
        setThread(null);
        setError(reason instanceof Error ? reason.message : "Unable to read this conversation.");
      }
    } finally {
      if (token === detailSequence.current) setDetailLoading(false);
    }
  }

  useEffect(() => {
    void loadThreads();
    const abort = new AbortController();
    void fetch(`/api/portal/documents?encounterId=${encodeURIComponent(encounterId)}`, {
      cache: "no-store",
      signal: abort.signal
    })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok || !result.ok || abort.signal.aborted) return;
        const attachments = (result.documents as PortalDocument[]).flatMap((document) =>
          document.versions
            .filter((version) => version.status === "PUBLISHED")
            .flatMap((version) =>
              version.files.map((file) => ({
                ...file,
                documentTitle: `${document.title} · v${version.version}`
              }))
            )
        );
        setFiles(attachments);
      })
      .catch(() => undefined);
    return () => {
      abort.abort();
      listSequence.current++;
      detailSequence.current++;
      listController.current?.abort();
      detailController.current?.abort();
    };
    // Encounter changes unmount all conversation drafts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [encounterId]);

  useEffect(() => {
    selected.current = threadId;
    setThread(null);
    setError("");
    if (!threadId) return;
    void loadThread(threadId);
    const timer = window.setInterval(() => {
      if (!busyRef.current) void loadThread(threadId, true);
    }, 8000);
    return () => {
      window.clearInterval(timer);
      detailSequence.current++;
      detailController.current?.abort();
    };
    // The stable thread identifier defines the selected conversation scope.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId]);

  const locked = busy || loading || detailLoading;
  const listed = threads.find((item) => item.id === threadId);
  return (
    <div className="pp-stack">
      <div className="pp-toolbar">
        <p className="pp-muted">
          Conversations are visible only to their named members with active sharing access.
        </p>
        <button type="button" disabled={locked} onClick={() => setNewThread((value) => !value)}>
          {newThread ? "Close new conversation" : "+ New conversation"}
        </button>
      </div>
      {newThread && (
        <Card title="Start a conversation" eyebrow="CHOOSE PARTICIPANTS CAREFULLY">
          <form
            className="pp-form"
            onSubmit={async (event) => {
              event.preventDefault();
              const values = new FormData(event.currentTarget);
              const result = await request(
                "/api/portal/messages",
                {
                  action: "createThread",
                  type,
                  subject: String(values.get("subject") ?? ""),
                  memberIds: values.getAll("memberIds").map(String),
                  ...(type === "CLAIM" ? { claimId: String(values.get("claimId") ?? "") } : {}),
                  ...(type === "RECORD_REQUEST"
                    ? { recordRequestId: String(values.get("recordRequestId") ?? "") }
                    : {})
                },
                "Conversation created. Its member list is now fixed."
              );
              if (result) {
                setNewThread(false);
                await loadThreads(String(result.threadId));
              }
            }}
          >
            <div className="pp-form-grid">
              <Field label="Conversation subject">
                <input name="subject" required maxLength={160} />
              </Field>
              <Field label="Conversation purpose">
                <select value={type} onChange={(event) => setType(event.target.value)}>
                  {types.map((value) => (
                    <option key={value} value={value}>
                      {readable(value)}
                    </option>
                  ))}
                </select>
              </Field>
              {type === "CLAIM" && (
                <Field label="Shared claim">
                  <select name="claimId" required>
                    <option value="">Select the claim</option>
                    {claims.map((claim) => (
                      <option key={claim.id} value={claim.id}>
                        {claim.reference} · {readable(claim.status)}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              {type === "RECORD_REQUEST" && (
                <Field label="Consented prior-record request">
                  <select name="recordRequestId" required>
                    <option value="">Select the request</option>
                    {liveRequests.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.reference} · {item.providerName}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
            </div>
            <fieldset className="pp-participant-picker" key={type}>
              <legend>Participants · you are included automatically</legend>
              {availableContacts.length ? (
                availableContacts.map((contact) => (
                  <label className="pp-check" key={contact.id}>
                    <input type="checkbox" name="memberIds" value={contact.id} />
                    <span>
                      <strong>{contact.name}</strong>
                      <small>
                        {readable(contact.role)}
                        {contact.organization ? ` · ${contact.organization}` : ""}
                      </small>
                    </span>
                  </label>
                ))
              ) : (
                <Empty>No permitted contacts are available for this purpose.</Empty>
              )}
            </fieldset>
            <p className="pp-help">
              The server checks every participant, linked claim or record request, and live consent.
              Participants cannot be added after creation.
            </p>
            {type === "CLAIM" && !claims.length && (
              <p className="pp-warning">
                No shared claim is available. Submit a claim and record sharing consent in the care
                journey first.
              </p>
            )}
            <button
              type="submit"
              disabled={
                locked ||
                !availableContacts.length ||
                (type === "CLAIM" && !claims.length) ||
                (type === "RECORD_REQUEST" && !liveRequests.length)
              }
            >
              Create conversation
            </button>
          </form>
        </Card>
      )}
      {loading && (
        <p className="pp-loading" role="status">
          Loading your conversations…
        </p>
      )}
      {error && (
        <div role="alert" className="pp-notice pp-error">
          {error}
          <button type="button" className="pp-subtle" onClick={() => void loadThreads()}>
            Refresh conversations
          </button>
        </div>
      )}
      {!loading && !error && !threads.length && (
        <Card title="Messages">
          <Empty>
            You have no conversations for this encounter. Start one with the hospital team.
          </Empty>
        </Card>
      )}
      {!!threads.length && (
        <div className="pp-message-layout">
          <aside className="pp-card pp-thread-list" aria-label="Conversation list">
            <h2>
              Conversations <span className="pp-count">{threads.length}</span>
            </h2>
            {threads.map((item) => (
              <button
                key={item.id}
                type="button"
                disabled={busy}
                className={item.id === threadId ? "pp-selected" : ""}
                onClick={() => setThreadId(item.id)}
              >
                <span className="pp-row-between">
                  <strong>{item.subject}</strong>
                  {item.unread > 0 && <span className="pp-unread">{item.unread}</span>}
                </span>
                <small>
                  {readable(item.type)} ·{" "}
                  {item.members.map((member) => member.name.split(" ")[0]).join(", ")}
                </small>
                <p>
                  {item.lastMessage
                    ? `${item.lastMessage.authorName}: ${item.lastMessage.body.slice(0, 100)}`
                    : "No messages yet"}
                </p>
              </button>
            ))}
          </aside>
          <section className="pp-card pp-conversation" aria-label="Selected conversation">
            {detailLoading && (
              <p role="status" className="pp-loading">
                Loading conversation…
              </p>
            )}
            {thread && (
              <>
                <header className="pp-conversation-header">
                  <div>
                    <Badge value={thread.type} />
                    <h2>{thread.subject}</h2>
                    <p>{thread.members.map((member) => member.name).join(" · ")}</p>
                  </div>
                  {(listed?.unread ?? 0) > 0 && (
                    <button
                      type="button"
                      className="pp-subtle"
                      disabled={locked}
                      onClick={async () => {
                        const result = await request(
                          "/api/portal/messages",
                          { action: "markRead", threadId },
                          "Conversation marked as read."
                        );
                        if (result) await loadThreads(threadId);
                      }}
                    >
                      Mark read
                    </button>
                  )}
                </header>
                <div className="pp-message-log" role="log" aria-live="polite" aria-label="Messages">
                  {thread.messages?.length ? (
                    thread.messages.map((message) => (
                      <article
                        key={message.id}
                        className={`pp-message ${message.authorId === actor.id ? "pp-message-own" : ""}`}
                      >
                        <div className="pp-message-author">
                          <strong>{message.authorName}</strong>
                          <small>
                            {readable(message.authorRole)} · {formatTime(message.createdAt)}
                          </small>
                        </div>
                        <p>{message.body}</p>
                        <FileLinks files={message.attachments ?? []} />
                      </article>
                    ))
                  ) : (
                    <Empty>No messages yet. Send the first message below.</Empty>
                  )}
                </div>
                <form
                  className="pp-form pp-composer"
                  key={thread.id}
                  onSubmit={async (event) => {
                    const values = formValues(event);
                    const form = event.currentTarget;
                    const body = new FormData(form);
                    const result = await request(
                      "/api/portal/messages",
                      {
                        action: "send",
                        threadId: thread.id,
                        body: values.body,
                        emailCopy: values.emailCopy === "on",
                        attachmentIds: body.getAll("attachmentIds").map(String)
                      },
                      "Message sent to the conversation members."
                    );
                    if (result) {
                      form.reset();
                      await Promise.allSettled([loadThreads(thread.id), loadThread(thread.id)]);
                    }
                  }}
                >
                  <Field
                    label={`Message to ${thread.members
                      .filter((member) => member.id !== actor.id)
                      .map((member) => member.name)
                      .join(", ")}`}
                  >
                    <textarea
                      name="body"
                      required
                      maxLength={10000}
                      rows={3}
                      placeholder="Write your message…"
                    />
                  </Field>
                  {files.length > 0 && (
                    <details className="pp-attachments">
                      <summary>Attach an accessible published document file</summary>
                      <div className="pp-attachment-picker">
                        {files.map((file) => (
                          <label className="pp-check" key={file.id}>
                            <input type="checkbox" name="attachmentIds" value={file.id} />
                            <span>
                              {file.originalName}
                              <small>{file.documentTitle}</small>
                            </span>
                          </label>
                        ))}
                      </div>
                    </details>
                  )}
                  <label className="pp-check">
                    <input type="checkbox" name="emailCopy" />
                    Create a simulated email notification for the other members
                  </label>
                  <div className="pp-row-between">
                    <small className="pp-muted">
                      Email copies contain a generic sign-in notice. No external email is sent.
                    </small>
                    <button type="submit" disabled={locked}>
                      Send message
                    </button>
                  </div>
                </form>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
