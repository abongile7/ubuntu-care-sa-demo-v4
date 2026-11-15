"use client";

import { useState } from "react";
import type {
  PortalActor,
  PortalContext,
  PortalRecommendation,
  PortalRun
} from "@/lib/portal-types";
import { Badge, Card, Empty, Field, formValues } from "./shared-ui";

export function AssistantPanel({
  data,
  actor,
  run,
  busy,
  navigate
}: {
  data: PortalContext;
  actor: PortalActor;
  run: PortalRun;
  busy: boolean;
  navigate: (tab: string) => void;
}) {
  const [reply, setReply] = useState<{
    answer: string;
    suggestions: PortalRecommendation[];
  } | null>(null);
  const [checks, setChecks] = useState<Record<string, unknown> | null>(null);
  const suggestions = reply?.suggestions ?? data.assistant?.recommendations ?? [];
  return (
    <div className="pp-grid pp-grid-wide">
      <Card title="Your next steps" eyebrow="WORKFLOW GUIDANCE · RULES MODE">
        <div className="pp-inline">
          <Badge value="RULES" />
          <span className="pp-muted">Uses only information your account can access.</span>
        </div>
        <p>{data.assistant?.summary ?? "Ask about the next workflow step for this encounter."}</p>
        {suggestions.length ? (
          <div className="pp-recommendations">
            {suggestions.map((suggestion, index) => (
              <article key={`${suggestion.title}-${index}`}>
                <span className="pp-step">{index + 1}</span>
                <div>
                  <h3>{suggestion.title}</h3>
                  <p>{suggestion.detail}</p>
                  {suggestion.tab && (
                    <button
                      type="button"
                      className="pp-subtle"
                      disabled={busy}
                      onClick={() => navigate(suggestion.tab)}
                    >
                      Open {suggestion.tab.replaceAll("_", " ")} →
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <Empty>No outstanding workflow steps are visible for this account.</Empty>
        )}
        <p className="pp-help">
          {data.assistant?.limitations ??
            "Human review is required for every decision and action. The assistant cannot diagnose, order care or approve a claim."}
        </p>
      </Card>
      <div className="pp-stack">
        <Card title="Ask the workflow assistant" eyebrow="HUMAN CONFIRMS EVERY WRITE">
          <form
            className="pp-form"
            onSubmit={async (event) => {
              const values = formValues(event);
              const form = event.currentTarget;
              const result = await run(
                "assistant",
                { message: values.message },
                "Workflow guidance ready."
              );
              if (result) {
                setReply({
                  answer: String(result.answer ?? "No guidance available."),
                  suggestions: (result.suggestions ?? []) as PortalRecommendation[]
                });
                form.reset();
              }
            }}
          >
            <Field label="What do you need help with?">
              <textarea
                name="message"
                required
                maxLength={2000}
                rows={4}
                placeholder="For example: What records are still needed?"
              />
            </Field>
            <button type="submit" disabled={busy}>
              Ask assistant
            </button>
          </form>
          {reply && (
            <div className="pp-assistant-answer" role="status">
              <strong>Rules-based guidance</strong>
              <p>{reply.answer}</p>
              <small>Human review required. No action has been taken automatically.</small>
            </div>
          )}
        </Card>
        {actor.role === "admin" && (
          <Card title="Demo readiness checks" eyebrow="ADMINISTRATOR">
            <p>
              Inspect configured demo features and stored data integrity. These checks do not
              establish clinical, legal or commercial readiness.
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                const result = await run("runChecks", {}, "Demo checks completed.");
                if (result) setChecks(result);
              }}
            >
              Run functional checks
            </button>
            {checks && (
              <div className="pp-checks" role="status">
                {renderChecks(checks)}
              </div>
            )}
          </Card>
        )}
        <Card title="Connected organisations" eyebrow="SIMULATED PROVIDER CATALOGUE">
          <p className="pp-help">
            This catalogue is a demo directory. Scheme authorisation and provider connections are
            simulated.
          </p>
          <ul className="pp-org-list">
            {data.organizations.map((org) => (
              <li key={org.name}>
                <strong>{org.name}</strong>
                <a href={org.website} target="_blank" rel="noreferrer">
                  Official website ↗
                </a>
                <Badge value={org.mode} />
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}

function renderChecks(checks: Record<string, unknown>) {
  const values = checks.checks ?? checks.results;
  if (Array.isArray(values))
    return (
      <>
        <ul>
          {values.map((value, index) => {
            const check = value as Record<string, unknown>;
            return (
              <li key={String(check.name ?? check.title ?? index)}>
                <div className="pp-row-between">
                  <strong>
                    {String(check.name ?? check.title ?? check.key ?? `Check ${index + 1}`)}
                  </strong>
                  {typeof check.passed === "boolean" && (
                    <Badge value={check.passed ? "PASSED" : "FAILED"} />
                  )}
                </div>
                <p>
                  {String(check.detail ?? check.message ?? check.status ?? check.ok ?? "Completed")}
                </p>
              </li>
            );
          })}
        </ul>
        {checks.commercialReady === false && (
          <p className="pp-help">Commercial readiness has not been established.</p>
        )}
        {Array.isArray(checks.limitations) && (
          <ul className="pp-help">
            {checks.limitations.map((limitation, index) => (
              <li key={index}>{String(limitation)}</li>
            ))}
          </ul>
        )}
      </>
    );
  return <pre>{JSON.stringify(checks, null, 2)}</pre>;
}
