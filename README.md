# UbuntuCare SA Demo v4

A fictional-data hospital workflow prototype built with Next.js App Router, Prisma, and SQLite. It demonstrates how patients, doctors, nurses, and administrators could share a patient record. Use synthetic data only; this repository is not ready to handle real patient information or support clinical care.

## Run locally

Use a current supported Node.js release and npm. From a fresh checkout:

```bash
cp .env.example .env
npm ci
npm run db:setup
npm run dev
```

Open `http://localhost:3000`. The example database URL creates `prisma/dev.db` locally.

**Reset behaviour:** both `npm run db:seed` and `npm run db:setup` delete existing patient records, related workflow data, and sessions in the configured database before recreating the demo. Run them only against a disposable demo database. Seeded accounts use the public password below.

## Demo accounts

| Workspace | Email | Password |
| --- | --- | --- |
| Patient (Ayanda Mokoena) | patient@ubuntucare.demo | Demo123! |
| Doctor | doctor@ubuntucare.demo | Demo123! |
| Nurse | nurse@ubuntucare.demo | Demo123! |
| Administrator | admin@ubuntucare.demo | Demo123! |

Additional seeded patient accounts are `nomvula@ubuntucare.demo` and `pieter@ubuntucare.demo`, with the same password. Sign out before changing roles, or use separate browser profiles for separate sessions.

## What works in this prototype

- Patient profile, contact details, medical aid, and consent fields.
- Arrival and handover records for an existing patient, including ambulance and transfer details.
- Appointment booking and staff status updates.
- Ward observations, medication orders, and administration records.
- Manually entered laboratory results and uploaded imaging previews.
- Theatre bookings, transfer records, documents, and admissions PDF export.
- Staff messages and tasks, plus a simulated email register.

Laboratory names and links are sample content, not live provider integrations. The email register does not send email, and imaging previews are not a diagnostic image viewer.

Follow the [focused demo walkthrough](docs/DEMO.md) to show one existing fictional patient across roles.

## Checks

```bash
npm run typecheck
npm run build
npm test
```

The integration tests create a disposable SQLite database and start a local development server. They do not reset your configured demo database.

## Current limits and deployment boundary

The app has no encounter-based admission/discharge lifecycle, laboratory-order workflow, or live EMS, hospital, or laboratory integration. A document labelled “Discharge summary” is a document, not a discharge transition. The admission readiness label is derived from profile completeness, not clinical approval.

Staff access remains broad across the demo's patient records; clinician assignments and department-based record restrictions are not implemented. A production pilot also needs an audit trail, authentication abuse controls, operational recovery, and a privacy and security assessment appropriate to its use. Public demo credentials and stock staff portraits must not be carried into a real deployment.

South African deployment requirements and costs depend on the intended function, clinical use, hosting, data processing, and facility requirements. There is no single certification count or fixed cost established by this repository. A fictional-data demonstration does not establish POPIA compliance or approval for real clinical use.
