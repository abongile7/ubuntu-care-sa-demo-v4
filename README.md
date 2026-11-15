# UbuntuCare SA — connected care demo

A Next.js, Prisma and SQLite prototype connecting a fictional patient's emergency call, ambulance transport, hospital care, discharge and private-hospital medical-aid claim. Eight role workspaces use the same persisted records with server-enforced permissions.

**Use fictional data only.** Calls, Home Affairs verification, medical-aid eligibility/authorisation, claim submission and payment are explicitly simulated. No external provider is contacted and no funds move. This is not a clinically validated or production-compliant hospital system.

## Launch the portal in GitHub Codespaces

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/abongile7/ubuntu-care-sa-demo-v4/tree/feat/paperless-hospital-portal?quickstart=1)

The link starts or resumes your own Codespace for the paperless preview branch. GitHub may ask you to confirm creation and use your account's Codespaces allowance. After setup, open **Ports → 3000 → Open in Browser**, then `/login`. The forwarded port is private by default. The app itself uses the demo accounts below.

The dev container installs dependencies, prepares the SQLite schema and seeds only an empty database. Restarting preserves existing records. It starts the app automatically; `npm run demo:start` restarts the preview if needed. The launch commands have been exercised against an isolated fresh database and a second run that preserved existing records; the GitHub-hosted container itself requires your Codespaces session to start.

## Run locally

Use Node.js 22 or a newer supported release and npm:

```bash
cp .env.example .env
npm ci
npm run db:setup
npm run dev
```

Open `http://localhost:3000/login`. Signing in opens `/journey`; **Documents & communication** opens the new `/connect` workspace. Referring practices open `/connect` directly. `/portal` retains the original detailed hospital workspace for the original four roles.

The example database is `prisma/dev.db`. **Both `db:setup` and `db:seed` reset patient/workflow data and sessions. Run them only against a disposable demo database.** A previously seeded database needs `npm run db:setup` to add the new schema and demo roles; back up anything you want to keep first.

## Demo accounts

All seeded accounts use `Demo123!`. They are public presentation credentials, not production accounts.

| Workspace | Email | Access |
| --- | --- | --- |
| Admissions | admin@ubuntucare.demo | Fictional registration, encounters, dispatch, admission/discharge, identity and funding checks, billing |
| Ambulance crew A | paramedic@ubuntucare.demo | Assigned transports, EMS/next-of-kin call simulation and handover |
| Doctor | doctor@ubuntucare.demo | Clinical notes, medication, lab orders/review and discharge readiness |
| Nurse | nurse@ubuntucare.demo | Handover, admission, observations, medication administration, specimen/results and discharge |
| Hospital billing | billing@ubuntucare.demo | Funding checks, medical-aid call simulation, invoice lines, validation/submission and payment simulation |
| Medical aid | insurer@ubuntucare.demo | Submitted, consented claim packets for Discovery Health Medical Scheme only |
| Patient | patient@ubuntucare.demo | Ayanda's journey, reviewed results, discharge instructions, consent choices and claim status |
| Referring practice | referring@ubuntucare.demo | Only assigned, unexpired consented requests and the documents supplied for those requests |

Additional accounts: `paramedic2@ubuntucare.demo` is crew B, `insurer2@ubuntucare.demo` represents Momentum Medical Scheme, and `nomvula@ubuntucare.demo` / `pieter@ubuntucare.demo` are separate patients. Ordinary tabs share login cookies: use separate browser profiles or sign out between roles.

New fictional registrations create a patient record with a random, undisclosed account password. The prototype does not implement patient invitations or password enrolment; new registrations do **not** inherit the public demo password.

## Connected workflow

```text
Call recorded → Dispatch → On scene → In transit → Hospital handover
→ Admission → Active care → Doctor discharge readiness → Discharge
→ Invoice → Validate → Simulated submission → Medical-aid review → Simulated payment
```

- Transitions enforce order, role, record version and prerequisites. Handover needs a note; discharge readiness needs a diagnosis, clinical/discharge summaries and reviewed or cancelled lab orders.
- Labs progress through request, specimen collection, result entry and doctor review. Patients see results only after review.
- Observations, prescriptions and administrations from the new journey append audit events transactionally. The patient chart also includes existing historical demo records.
- Funding checks and identity simulations require recorded consent and an explicit purpose. Funding failure does not prevent clinical admission or discharge.
- Claims use integer ZAR cents and server-calculated totals. Submission rechecks eligibility, authorisation, consent, diagnosis, discharge and invoice data.
- Medical-aid reviewers see a frozen, minimal submitted packet for their scheme. Full identity numbers, contacts, clinical notes and raw laboratory results are excluded. Consent revocation blocks further reviewer access in this demo; it cannot retract an already downloaded packet.
- Returned claims can be corrected, validated and resubmitted. Submitted invoices cannot be edited in place. Payment is a recorded simulation, not a transfer.

Follow [docs/DEMO.md](docs/DEMO.md) for a complete presentation and [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md) for API and provider boundaries.

## Paperless coordination workspace

`/connect` adds persisted, audited workflows:

- Member-only care, claim, handover and previous-practice conversations; file sharing is checked for every member. Email notification copies are generic and **simulated**, with no SMTP delivery.
- Private PDF/PNG/JPEG/UTF-8 text uploads up to 5 MiB per file, MIME/signature checks, versioned documents and protected downloads/Unicode print views. Published bodies and attachments are immutable; corrections create a new version.
- Typed **demo acknowledgements** bound to the authenticated account, exact version/hash and timestamp. These are not accredited advanced signatures or a substitute for document-specific legal review.
- Appointment requests/confirmation, clinician conflict checks across encounters, SAST calendars, private ICS exports, cancellations and durable deduplicated reminders.
- Patient concerns with a named owner, human-review notifications, append-only responses, resolution and reopening. This is not a monitored emergency service.
- Explicitly scoped prior-records requests, a limited referring-practice account, protected upload/fulfilment, hospital doctor review, expiry and revocation. The app does not automatically fetch another practice's records.
- Department work queues across 20 services and a **rules-based workflow assistant** with human confirmation. These queues do not constitute validated ICU, pharmacy, theatre, blood-bank or diagnostic systems; there is no model-provider connection or autonomous clinical decision maker.
- Read-only administrator checks for database/document integrity, clearly separated from the full automated suite and commercial readiness.

### Reminders and video

```bash
npm run reminders:run       # one due-reminder batch
npm run reminders:worker    # keep processing every 30 seconds
```

In-app reminders persist; email reminders go only to the simulated outbox. A deployed demo needs the worker (or an equivalent scheduler) running independently of browser tabs. The worker also removes expired signaling from abandoned video rooms; authenticated signaling access always filters expired rows.

Confirmed VIDEO appointments have authenticated patient/assigned-clinician signaling, recorded consent, local camera/microphone controls, mute/end and cleanup. No recording or third-party media/STUN/TURN service is configured. Direct WebRTC needs a route between the peers; production cross-network calls require an approved TURN/media design and validation. This managed Cloud browser enforces `WebRtcIPHandling=disable_non_proxied_udp`; a complete media connection could not be verified here. Signaling/permissions, local device controls and teardown are checked separately; that does not establish production video reliability.

### South African pilot research

Start with one private hospital, one service line and one ward. See [South African requirements and primary sources](docs/SOUTH_AFRICA_READINESS.md), the [20-department workflow and commercial pilot roadmap](docs/HOSPITAL_ROADMAP.md), and the [paperless demonstration](docs/PAPERLESS_DEMO.md). They distinguish legislation, professional guidance, design recommendations, simulated services and remaining acceptance work. There is no universal medical-aid integration API or evidence that every scheme has authorised this portal.

## Checks

```bash
npm run typecheck
npm run build
npm test
```

Type checking generates Next.js route types. HTTP tests copy the source into a temporary app, create a disposable SQLite database, start a local server and clean up. They do not read your `.env` or reset your demo database. GitHub Actions runs these checks on pushes and pull requests.

## Original hospital modules

The detailed workspace still supports appointments, radiology preview uploads, theatre bookings, transfers, documents, staff messages/tasks, a simulated email register and admissions PDF export. Ambulance, billing and insurer accounts are explicitly denied access to these legacy clinical APIs. The new journey has encounter audit events; the legacy modules do not yet provide a comprehensive clinical audit trail.

## Publication and deployment

GitHub hosts this source and CI. GitHub Pages cannot run the Next.js/Prisma/SQLite backend. To run the demo on a Node host, supply `DATABASE_URL` pointing to a writable, persistent SQLite volume, initialise that **disposable demo** database, build and run `npm start` behind HTTPS. Do not run reseeding commands on an existing database as part of routine startup. Serverless hosts with ephemeral filesystems need a database/storage redesign.

No live Home Affairs, phone-provider, medical-aid, clearinghouse or payment credentials are configured. Real integrations require approved APIs, contracts, documented payloads, test credentials and provider-specific validation. This prototype does not establish POPIA compliance, clinical safety, eligibility, claim acceptance or deployment approval.

## Remaining boundaries

Clinical/admissions/billing staff share one demonstration facility; private file storage is SQLite BLOB storage for the demo, and production malware scanning/private object storage are pending; clinician assignment, facility tenancy, production account enrolment, comprehensive legacy audit coverage, authentication abuse controls, diagnostic imaging, tariff/ICD catalogue validation, backups and recovery need further work. Staff portraits and provider links in the older workspace are sample content.

The dependency audit still has transitive findings in Prisma/config/deepmerge-ts, Next/PostCSS and esbuild. Compatible fixes were applied in the preceding review; remaining major-version or override changes need separate compatibility work. Do not interpret passing functional tests as a security audit or clinical approval.
