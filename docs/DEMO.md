# Focused fictional-patient demo

Demonstrate one narrow workflow: record an arrival, coordinate care records across staff roles, and show the same patient's results in the patient portal. Describe the larger hospital journey as a roadmap.

## Prepare

1. Follow the setup instructions in the [README](../README.md).
2. Keep the seeded patient **Ayanda Mokoena**, file **UC-2026-00081**, as the case throughout. Staff must select this patient in **Switch patient case** after every login.
3. Sign out between roles, or use separate browser profiles. Ordinary tabs share the same login session.
4. Use fictional entries and uploads. Seeded appointments and results have fixed April 2026 dates; enter a new appointment date for the presentation.

## Walkthrough

| Step | Role | Action | Evidence to show |
| --- | --- | --- | --- |
| 1 | Administrator | Select Ayanda. In **Ambulance, casualty, and transfer intake**, register an ambulance arrival with a fictional source and handover note. | The arrivals board shows the entry linked to Ayanda. This records an arrival against an existing profile. |
| 2 | Administrator | In **Admissions and bookings**, book a ward review at a chosen future date and export the admissions PDF. | The appointment and PDF use the selected patient's record. |
| 3 | Nurse | Select Ayanda. In **Record blood pressure and daily vitals**, save a new set of fictional observations. | The latest observation appears with recorder and timestamp. |
| 4 | Doctor | Select Ayanda. Review the observations, add a clearly labelled demo medication order, and enter a fictional laboratory result in **Ampath / lab results** using “Demo laboratory” as provider. | The order and result appear in the same patient's record. The result is manually entered, not received from a live laboratory. |
| 5 | Nurse | Select Ayanda and the newly created order in **Medication chart and administration**. Log a simulated administration. | The administration record refers to that patient's medication order. |
| 6 | Doctor | Select Ayanda. In **Documents and release**, create a document with category **Discharge summary**, title **DEMO — care summary**, and fictional follow-up text. | The document register contains the new summary. Creating it does not discharge the patient. |
| 7 | Patient | Sign in as `patient@ubuntucare.demo`. | The patient portal shows Ayanda's appointment, medication order, latest result, and latest document. |

## Explain the scope accurately

The value demonstrated is persistence and coordination across four role workspaces. Arrival records, observations, orders, results, and documents share a patient profile.

The prototype does not yet represent a complete clinical episode. New-patient registration, encounter-based admission and discharge transitions, laboratory orders, clinician review/sign-off, and external integrations need further implementation. Staff permissions are broad in this demo; assignment-based access and a full audit trail remain work for a production design.

For the next increment, define one encounter with explicit arrival, admission, care, and discharge states, together with who may make each transition. Validate that workflow with an intended facility before extending into more departments.

## Discuss deployment concerns

It is reasonable to expect substantial work before a real hospital deployment. The exact obligations and cost depend on the proposed use, the data involved, the deployment model, and the facility's procurement and security requirements. Avoid promising either a universal list of certifications or a fixed multimillion-rand cost without assessing that use case. This synthetic-data presentation demonstrates a concept; it is not evidence of POPIA compliance, clinical validation, or deployment approval.
