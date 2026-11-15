# Complete fictional-patient walkthrough

Use Ayanda Mokoena (`UC-2026-00081`) throughout. Seeding creates a requested ambulance encounter assigned to crew A and a separate admitted encounter for Pieter assigned to crew B. Always check the selected patient before acting.

All checks, calls, submissions and payments are simulated. Use separate browser profiles for roles, or sign out and back in. The login cards open the connected journey at `/journey`.

| Step | Role | Visible action and result |
| --- | --- | --- |
| 1 | Admissions | Choose Ayanda. In **Care journey**, confirm consent choices. In **Identity & medical aid**, confirm the purpose/consent and simulate identity verification. Check eligibility and request authorisation. Try unavailable/declined scenarios if useful, then repeat with eligible/approved for the final claim. |
| 2 | Admissions | In **Care journey**, log a fictional inbound EMS call if needed and select **Move to dispatched**. |
| 3 | Ambulance crew | Sign in as crew A. Move to **on scene**, then **in transit**. Save handover notes describing fictional assessment and receiving staff. Log a simulated coordination call. Move to **handed over**. Crew B cannot open crew A's assigned encounter. |
| 4 | Admissions | Select Ayanda, enter ward and bed, then move to **admitted**. |
| 5 | Nurse | Move to **in care**. Open **Clinical care**, enter fictional observations and save. |
| 6 | Doctor | Add a clinical note or patient-visible update. Request a fictional lab test, such as **DEMO full blood count**, and enter a clearly fictional medication order. |
| 7 | Nurse | Record specimen collection, then a fictional result. Select Given/Withheld/Missed for the medication and log simulated administration. |
| 8 | Patient | Open **Clinical care**. The unreleased lab result is absent. |
| 9 | Doctor | Review and release the result. The patient can now see it. In **Care journey**, enter a demo diagnosis code such as **R51**, clinical summary and discharge instructions; move to **ready for discharge**. Pending labs must be reviewed or cancelled first. |
| 10 | Nurse or admissions | Move to **discharged**. This transition does not depend on medical-aid funding or payment. |
| 11 | Billing | In **Identity & medical aid**, complete eligibility and authorisation if not done earlier. In **Claims**, create a draft and add invoice lines, for example `DEMO-CONSULT`, quantity 1, unit price `750.25`. These are fictional service codes and fees. |
| 12 | Billing | Validate the claim. The UI lists missing prerequisites. When validation passes, submit to the simulated medical-aid queue. Download the submitted JSON packet if desired. |
| 13 | Medical aid | Sign in as the Discovery reviewer. Only the consented, submitted packet for that scheme appears. Approve it, request information with a note, or reject it with a reason. The reviewer cannot see the clinical chart or other schemes' claims. |
| 14 | Billing | For an information request, correct draft lines, validate and resubmit. After approval, record simulated payment. No real claim transmission or funds transfer occurs. |
| 15 | Patient | View the reviewed result, discharge instructions and claim status. Revoke information sharing in **Care journey** to demonstrate that further medical-aid packet access is denied. |

The activity view records encounter, care, funding and claim events according to the current role. Patient activity is limited to public stage changes; the medical-aid screen exposes submitted claim information rather than the hospital's internal activity log.

## New patient example

Admissions can register a fictional patient at the bottom of **Care journey**, with a name, birth date, fictional ID or passport, email, phone and funding details. Record consent explicitly. Then select that patient in **Open a patient encounter**, choose a crew, reason, pickup location and triage, and open the encounter. This creates an actual persisted record; account invitation/enrolment remains a separate future workflow.

## Explain the boundaries

This version demonstrates a complete, persisted **simulated** workflow. It does not certify clinical safety, identity authenticity, actual insurance cover or successful real-world claims. A Home Affairs simulation checks the saved fictional patient's identity; it does not retrieve arbitrary people's information. Production services need approved access and implementation against their real contracts.
