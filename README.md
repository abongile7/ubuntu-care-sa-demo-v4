# UbuntuCare SA Demo v4

Paperless South African hospital demo built with Next.js App Router, Prisma, and SQLite.

## Included role workspaces

- Patient portal
- Doctor cockpit
- Nurse station
- Admin command centre

## Included modules

- South African admission and medical aid profile
- Casualty / ambulance / inter-hospital arrival board
- Ward observations and daily blood pressure charting
- Medication prescribing and administration
- Lab results from providers such as Ampath
- MRI / CT / X-ray / ultrasound upload and preview
- Theatre booking
- Transfer and transport coordination
- Digital documents, sick notes, and queued email register
- Admissions PDF export

## Demo credentials

- patient@ubuntucare.demo / Demo123!
- doctor@ubuntucare.demo / Demo123!
- nurse@ubuntucare.demo / Demo123!
- admin@ubuntucare.demo / Demo123!

## Run locally

```bash
npm install
npm run db:setup
npm run dev
```

Open `http://localhost:3000`.

## Notes

- Email sending is simulated and stored in the in-app email queue unless real SMTP credentials are added later.
- Demo portraits use remote stock headshots and should be replaced with approved staff images before real deployment.
