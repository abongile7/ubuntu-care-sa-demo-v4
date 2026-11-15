# Simulated integration and access contract

The integration routes run on the server with the authenticated actor. They make no external requests. Provider references start with `SIM-`; the UI labels the environment and each service as simulated. There are no hidden live-mode switches or credentials.

## Services

| Endpoint/action | Allowed roles | Behaviour |
| --- | --- | --- |
| `POST /api/integrations`, `verifyIdentity` | Admissions | Existing encounter patient only; privacy consent, explicit confirmation and purpose required. Scenarios `match`, `mismatch`, `unavailable`. Stores/returns last four identity characters and a simulated reference. Does not retrieve government records or look up another person. |
| `checkEligibility` | Admissions, billing | Current saved scheme/membership, privacy and information-sharing consent, purpose and confirmation required. Scenarios `eligible`, `not_found`, `unavailable`; self-pay returns `SELF_PAY`. |
| `requestAuthorization` | Admissions, billing | Requires current eligible membership and consent. Scenarios `approved`, `declined`, `unavailable`. Creates a simulated authorisation reference, not a guarantee of cover. |
| `simulateCall` | Admissions, doctor, nurse, billing, assigned crew | Persists direction, purpose, contact and notes with `SIMULATED_COMPLETED`. Billing is limited to medical-aid calls; crews to EMS/next-of-kin calls. No dialling, messaging, recording or external contact occurs. |

## Encounter API

`GET /api/journey?encounterId=...` returns role-specific projections; inaccessible IDs return 404. `POST /api/journey` accepts actions for registration, creation, ordered state transitions, consent, notes, observations, prescriptions/administrations and lab processing. Mutation errors use 400 for invalid input, 403 for prohibited roles, 404 for inaccessible/missing resources and 409 for stale or invalid workflow state.

State transitions require a numeric `version` from the latest response. The service applies the transition and audit event in one transaction. Existing charts remain patient-level records; the new journey records their creation against the acting encounter's audit history. Encounter clinical entries require active care; corrections/amendments to closed encounter records are not implemented.

## Claims

`POST /api/claims` supports `create`, `addLine`, `removeLine`, `validate`, `submit`, `review`, and `pay`. Except creation, mutations require `claimId`, `encounterId` and the latest numeric `version`.

Amounts are integer ZAR cents; quantity is a positive integer. The server calculates every line and invoice total. The demo limits an invoice to R1,000,000. These fees and service codes are presentation examples; this is not tariff validation, tax processing or a clearinghouse format.

Validation returns `{ok: true, valid: false, errors: [...]}` when prerequisites are incomplete, without submitting the claim. Final submission repeats the checks in its transaction. Eligible, authorised, consented funding; diagnosis; discharge; summary; and a nonzero valid invoice are required. Funding does not control clinical admission/discharge.

The submitted snapshot includes patient name/file reference, scheme, masked membership, encounter dates, diagnosis code, authorisation, invoice lines, currency and total. It excludes full identity numbers, contacts, free-text clinical notes, raw lab results and the full discharge narrative. Medical-aid reviewers are scoped to their organisation and consented, submitted claims. A reviewer sees the last submitted snapshot while a returned invoice is corrected; resubmission replaces it. Consent revocation blocks future access, but cannot retract copies already downloaded.

`GET /api/claims/{claimId}/export` downloads the submitted JSON packet for admissions/billing or the correct authorised reviewer. It is private and non-cacheable. Patients see their own claim status/totals in their workspace, not the staff claim-management API.

## Connecting a real provider later

1. Obtain the provider's authorised sandbox access, service agreement, API documentation and credentials through its normal process.
2. Replace the simulated branch behind the server-side service boundary; preserve the permission, patient scope, consent/purpose and minimal-payload checks.
3. Implement the provider's identity/membership matching rules, authentication, error semantics, idempotency, callbacks, timeouts, retries and reconciliation. Do not equate a demo outcome with a real provider decision.
4. Validate real claim coding, hospital/practitioner identifiers, attachments, billing rules, security and operational requirements before a real-data pilot.

The insurer affiliation is read from `User.organization`, not supplied by the caller. Original clinical APIs explicitly reject the new ambulance, billing and insurer roles. Doctor/nurse/admissions access is broad within this single-facility demonstration; production facility tenancy and clinician assignment remain future work.
