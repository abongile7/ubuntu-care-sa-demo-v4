import bcrypt from "bcryptjs";
import { PrismaClient, Role, Channel } from "@prisma/client";

const prisma = new PrismaClient();

async function ensureUser(params: {
  email: string;
  name: string;
  role: Role;
  unit: string;
  passwordHash: string;
}) {
  return prisma.user.upsert({
    where: { email: params.email },
    update: {
      name: params.name,
      passwordHash: params.passwordHash,
      role: params.role,
      unit: params.unit
    },
    create: {
      name: params.name,
      email: params.email,
      passwordHash: params.passwordHash,
      role: params.role,
      unit: params.unit
    }
  });
}

async function main() {
  const passwordHash = await bcrypt.hash("Demo123!", 10);

  const seededUsers = await Promise.all([
    ensureUser({
      email: "patient@ubuntucare.demo",
      name: "Ayanda Mokoena",
      role: Role.patient,
      unit: "Ward B7",
      passwordHash
    }),
    ensureUser({
      email: "nomvula@ubuntucare.demo",
      name: "Nomvula Jacobs",
      role: Role.patient,
      unit: "Maternity",
      passwordHash
    }),
    ensureUser({
      email: "pieter@ubuntucare.demo",
      name: "Pieter van der Merwe",
      role: Role.patient,
      unit: "Cardiology",
      passwordHash
    }),
    ensureUser({
      email: "doctor@ubuntucare.demo",
      name: "Dr. Leila Naidoo",
      role: Role.doctor,
      unit: "Radiology and Clinical Review",
      passwordHash
    }),
    ensureUser({
      email: "nurse@ubuntucare.demo",
      name: "Sr. Naledi Khumalo",
      role: Role.nurse,
      unit: "Ward B7",
      passwordHash
    }),
    ensureUser({
      email: "admin@ubuntucare.demo",
      name: "Lerato Moletsane",
      role: Role.admin,
      unit: "Admissions Command Centre",
      passwordHash
    })
  ]);

  await prisma.session.deleteMany();
  await prisma.arrivalRecord.deleteMany();
  await prisma.emailLog.deleteMany();
  await prisma.documentRecord.deleteMany();
  await prisma.transferRecord.deleteMany();
  await prisma.theatreCase.deleteMany();
  await prisma.labResult.deleteMany();
  await prisma.medicationAdministration.deleteMany();
  await prisma.medicationOrder.deleteMany();
  await prisma.vitalRecord.deleteMany();
  await prisma.appointment.deleteMany();
  await prisma.scanRecord.deleteMany();
  await prisma.messageRecord.deleteMany();
  await prisma.shiftTask.deleteMany();
  await prisma.patientProfile.deleteMany();

  const profiles = [
    {
      userId: seededUsers[0].id,
      facilityFileNumber: "UC-2026-00081",
      fullName: "Ayanda Mokoena",
      saId: "9001015800087",
      passportNumber: "N/A",
      citizenship: "South African",
      dateOfBirth: new Date("1990-01-01"),
      gender: "Female",
      phone: "+27 82 555 0142",
      email: "patient@ubuntucare.demo",
      language: "isiZulu",
      preferredContactMethod: "WhatsApp",
      province: "Gauteng",
      city: "Johannesburg",
      address: "14 Willow Crescent, Rosebank",
      postalCode: "2196",
      maritalStatus: "Single",
      occupation: "Marketing manager",
      employer: "Apex Brands",
      employerPhone: "+27 11 555 1144",
      religion: "Christian",
      homeClinic: "Rosebank Family Practice",
      arrivalMode: "Private transport",
      arrivalReason: "Headaches and dizziness for 5 days",
      broughtBy: "Self",
      referralSource: "Specialist referral",
      referringDoctor: "Dr. Priya Nene",
      transferredFrom: "",
      transferReason: "",
      medicalAidScheme: "Discovery Health Medical Scheme",
      medicalAidPlan: "KeyCare Plus",
      medicalAidNumber: "DHMS-88429110",
      membershipTier: "Gold",
      principalMemberName: "Ayanda Mokoena",
      principalMemberNumber: "PM-882211",
      relationshipToPrincipalMember: "Self",
      nextOfKin: "Thabo Mokoena",
      nextOfKinRelation: "Brother",
      nextOfKinPhone: "+27 83 333 1944",
      guardianName: "",
      guardianPhone: "",
      bloodType: "O+",
      allergies: "Penicillin",
      currentMedication: "Amlodipine 5mg daily",
      chronicConditions: "Hypertension",
      disabilitySupport: "None",
      pregnancyStatus: "Not pregnant",
      visitPathway: "Neurology / Radiology",
      triagePriority: "Yellow",
      ward: "Ward B7",
      bedNumber: "B7-14",
      interpreterRequired: false,
      popiaConsent: true,
      consentTreatment: true,
      consentDataSharing: true,
      consentBilling: true
    },
    {
      userId: seededUsers[1].id,
      facilityFileNumber: "UC-2026-00082",
      fullName: "Nomvula Jacobs",
      saId: "9404020741088",
      passportNumber: "N/A",
      citizenship: "South African",
      dateOfBirth: new Date("1994-04-02"),
      gender: "Female",
      phone: "+27 72 555 0102",
      email: "nomvula@ubuntucare.demo",
      language: "English",
      preferredContactMethod: "SMS",
      province: "Western Cape",
      city: "Cape Town",
      address: "21 Main Road, Claremont",
      postalCode: "7708",
      maritalStatus: "Married",
      occupation: "Teacher",
      employer: "Westview Primary",
      employerPhone: "+27 21 555 1010",
      religion: "Christian",
      homeClinic: "Claremont Women Clinic",
      arrivalMode: "Ambulance",
      arrivalReason: "Pregnancy-related abdominal pain",
      broughtBy: "EMS",
      referralSource: "Clinic referral",
      referringDoctor: "Dr. T. Petersen",
      transferredFrom: "Claremont Women Clinic",
      transferReason: "Obstetric evaluation",
      medicalAidScheme: "Bonitas Medical Fund",
      medicalAidPlan: "Hospital Standard",
      medicalAidNumber: "BON-3382110",
      membershipTier: "Silver",
      principalMemberName: "Nomvula Jacobs",
      principalMemberNumber: "PM-110220",
      relationshipToPrincipalMember: "Self",
      nextOfKin: "Liam Jacobs",
      nextOfKinRelation: "Spouse",
      nextOfKinPhone: "+27 74 111 2244",
      guardianName: "",
      guardianPhone: "",
      bloodType: "A+",
      allergies: "None known",
      currentMedication: "Prenatal vitamins",
      chronicConditions: "None documented",
      disabilitySupport: "None",
      pregnancyStatus: "Third trimester",
      visitPathway: "Maternity",
      triagePriority: "Orange",
      ward: "Women’s Health",
      bedNumber: "WH-05",
      interpreterRequired: false,
      popiaConsent: true,
      consentTreatment: true,
      consentDataSharing: true,
      consentBilling: true
    },
    {
      userId: seededUsers[2].id,
      facilityFileNumber: "UC-2026-00083",
      fullName: "Pieter van der Merwe",
      saId: "8609225011086",
      passportNumber: "N/A",
      citizenship: "South African",
      dateOfBirth: new Date("1986-09-22"),
      gender: "Male",
      phone: "+27 82 555 0189",
      email: "pieter@ubuntucare.demo",
      language: "Afrikaans",
      preferredContactMethod: "Phone call",
      province: "Gauteng",
      city: "Centurion",
      address: "8 Ridgeway Drive, Centurion",
      postalCode: "0157",
      maritalStatus: "Married",
      occupation: "Project engineer",
      employer: "GridLine Energy",
      employerPhone: "+27 12 555 6655",
      religion: "Christian",
      homeClinic: "Centurion Medical Rooms",
      arrivalMode: "Inter-facility transfer",
      arrivalReason: "Chest pain and shortness of breath",
      broughtBy: "Transferred from district hospital",
      referralSource: "Inter-hospital referral",
      referringDoctor: "Dr. Johan Smit",
      transferredFrom: "Centurion District Hospital",
      transferReason: "Cardiology stepdown and angiogram review",
      medicalAidScheme: "Momentum Medical Scheme",
      medicalAidPlan: "Custom Option",
      medicalAidNumber: "MOM-5622110",
      membershipTier: "Platinum",
      principalMemberName: "Pieter van der Merwe",
      principalMemberNumber: "PM-449911",
      relationshipToPrincipalMember: "Self",
      nextOfKin: "Elize van der Merwe",
      nextOfKinRelation: "Spouse",
      nextOfKinPhone: "+27 82 771 9911",
      guardianName: "",
      guardianPhone: "",
      bloodType: "B+",
      allergies: "NSAIDs",
      currentMedication: "Bisoprolol, Aspirin, Statin",
      chronicConditions: "Ischaemic heart disease",
      disabilitySupport: "None",
      pregnancyStatus: "Not applicable",
      visitPathway: "Cardiology",
      triagePriority: "Orange",
      ward: "Cardiac Stepdown",
      bedNumber: "C4-09",
      interpreterRequired: false,
      popiaConsent: true,
      consentTreatment: true,
      consentDataSharing: true,
      consentBilling: true
    }
  ];

  const patients = [];
  for (const profile of profiles) {
    patients.push(
      await prisma.patientProfile.create({
        data: profile
      })
    );
  }

  const [ayanda, nomvula, pieter] = patients;

  await prisma.appointment.createMany({
    data: [
      {
        reference: "APT-2001",
        patientId: ayanda.id,
        department: "Radiology",
        clinician: "Dr. Leila Naidoo",
        scheduledAt: new Date("2026-04-03T10:30:00"),
        type: "MRI Brain Review",
        status: "Confirmed",
        location: "Parktown Imaging Centre",
        notes: "Bring prior headache diary and previous imaging if available.",
        createdByRole: Role.admin
      },
      {
        reference: "APT-2002",
        patientId: ayanda.id,
        department: "General Medicine",
        clinician: "Dr. Kabelo Maseko",
        scheduledAt: new Date("2026-04-04T08:00:00"),
        type: "Ward review",
        status: "In progress",
        location: "Ward B7",
        notes: "Review blood pressure trend and MRI findings.",
        createdByRole: Role.doctor
      },
      {
        reference: "APT-2003",
        patientId: nomvula.id,
        department: "Maternity",
        clinician: "Dr. A. Petersen",
        scheduledAt: new Date("2026-04-02T14:00:00"),
        type: "Ward review",
        status: "Checked in",
        location: "Women’s Health Unit",
        notes: "Monitor fetal wellbeing and pain progression.",
        createdByRole: Role.admin
      },
      {
        reference: "APT-2004",
        patientId: pieter.id,
        department: "Cardiology",
        clinician: "Dr. Kabelo Maseko",
        scheduledAt: new Date("2026-04-02T09:30:00"),
        type: "Cardiology Consultation",
        status: "Confirmed",
        location: "Cardiac Stepdown",
        notes: "Review troponin trend, ECG, and angiogram plan.",
        createdByRole: Role.admin
      }
    ]
  });

  await prisma.scanRecord.createMany({
    data: [
      {
        reference: "SCAN-3001",
        patientId: ayanda.id,
        title: "MRI brain without contrast",
        modality: "MRI",
        takenAt: new Date("2026-04-01T07:45:00"),
        department: "Radiology",
        uploadedBy: "Dr. Leila Naidoo",
        uploadedByRole: Role.doctor,
        notes: "No acute bleed noted. Awaiting formal report correlation.",
        previewData: "/scan-preview.svg"
      },
      {
        reference: "SCAN-3002",
        patientId: pieter.id,
        title: "Portable chest X-ray",
        modality: "X-Ray",
        takenAt: new Date("2026-04-01T08:10:00"),
        department: "Radiology",
        uploadedBy: "Sr. Naledi Khumalo",
        uploadedByRole: Role.nurse,
        notes: "Uploaded for consultant review after transfer in.",
        previewData: "/scan-preview.svg"
      }
    ]
  });

  await prisma.messageRecord.createMany({
    data: [
      {
        reference: "MSG-4001",
        channel: Channel.Ward,
        authorName: "Sr. Naledi Khumalo",
        authorRole: Role.nurse,
        body: "Ayanda’s overnight BP remained elevated. Latest observations added for the morning round."
      },
      {
        reference: "MSG-4002",
        channel: Channel.Radiology,
        authorName: "Dr. Leila Naidoo",
        authorRole: Role.doctor,
        body: "MRI review will be uploaded after multidisciplinary meeting at 10:00."
      },
      {
        reference: "MSG-4003",
        channel: Channel.Transfers,
        authorName: "Lerato Moletsane",
        authorRole: Role.admin,
        body: "Cardiology transfer paperwork for Pieter completed. Ambulance ETA 16:30 confirmed."
      },
      {
        reference: "MSG-4004",
        channel: Channel.Laboratory,
        authorName: "Sr. Naledi Khumalo",
        authorRole: Role.nurse,
        body: "Ampath CBC and U&E for Ayanda have been received and attached to the case."
      }
    ]
  });

  await prisma.shiftTask.createMany({
    data: [
      {
        reference: "TASK-5001",
        title: "Verify Discovery funding and excess",
        owner: "Lerato Moletsane",
        department: "Billing",
        priority: "High",
        status: "In progress",
        eta: "14:00"
      },
      {
        reference: "TASK-5002",
        title: "Complete morning medication round",
        owner: "Sr. Naledi Khumalo",
        department: "Ward B7",
        priority: "Critical",
        status: "Queued",
        eta: "08:30"
      },
      {
        reference: "TASK-5003",
        title: "Book theatre slot for urgent C-section standby",
        owner: "Sipho Dlamini",
        department: "Theatre",
        priority: "High",
        status: "Queued",
        eta: "11:00"
      }
    ]
  });

  await prisma.vitalRecord.createMany({
    data: [
      {
        reference: "VTL-6001",
        patientId: ayanda.id,
        recordedBy: "Sr. Naledi Khumalo",
        recordedByRole: Role.nurse,
        recordedAt: new Date("2026-04-01T06:00:00"),
        systolic: 146,
        diastolic: 92,
        pulse: 84,
        temperature: 36.7,
        respiratoryRate: 18,
        spo2: 98,
        glucose: "5.8 mmol/L",
        painScore: 4,
        notes: "Headache improved after analgesia."
      },
      {
        reference: "VTL-6002",
        patientId: ayanda.id,
        recordedBy: "Sr. Naledi Khumalo",
        recordedByRole: Role.nurse,
        recordedAt: new Date("2026-04-01T12:00:00"),
        systolic: 150,
        diastolic: 94,
        pulse: 88,
        temperature: 36.8,
        respiratoryRate: 18,
        spo2: 99,
        glucose: "5.9 mmol/L",
        painScore: 3,
        notes: "Stable. Awaiting doctor review."
      },
      {
        reference: "VTL-6003",
        patientId: pieter.id,
        recordedBy: "Sr. Naledi Khumalo",
        recordedByRole: Role.nurse,
        recordedAt: new Date("2026-04-01T09:00:00"),
        systolic: 138,
        diastolic: 85,
        pulse: 78,
        temperature: 36.5,
        respiratoryRate: 20,
        spo2: 96,
        glucose: "6.4 mmol/L",
        painScore: 2,
        notes: "Chest discomfort settled."
      }
    ]
  });

  const ayandaMeds = await Promise.all([
    prisma.medicationOrder.create({
      data: {
        reference: "MED-7001",
        patientId: ayanda.id,
        prescribedBy: "Dr. Kabelo Maseko",
        prescribedByRole: Role.doctor,
        prescribedAt: new Date("2026-04-01T07:00:00"),
        drugName: "Amlodipine",
        dose: "5 mg",
        route: "Oral",
        frequency: "Daily",
        indication: "Blood pressure control",
        startDate: new Date("2026-04-01"),
        endDate: null,
        status: "Active"
      }
    }),
    prisma.medicationOrder.create({
      data: {
        reference: "MED-7002",
        patientId: ayanda.id,
        prescribedBy: "Dr. Kabelo Maseko",
        prescribedByRole: Role.doctor,
        prescribedAt: new Date("2026-04-01T07:10:00"),
        drugName: "Paracetamol",
        dose: "1 g",
        route: "Oral",
        frequency: "6 hourly PRN",
        indication: "Headache",
        startDate: new Date("2026-04-01"),
        endDate: null,
        status: "Active"
      }
    })
  ]);

  const pieterMeds = await Promise.all([
    prisma.medicationOrder.create({
      data: {
        reference: "MED-7003",
        patientId: pieter.id,
        prescribedBy: "Dr. Kabelo Maseko",
        prescribedByRole: Role.doctor,
        prescribedAt: new Date("2026-04-01T08:30:00"),
        drugName: "Aspirin",
        dose: "150 mg",
        route: "Oral",
        frequency: "Daily",
        indication: "Cardiac prevention",
        startDate: new Date("2026-04-01"),
        endDate: null,
        status: "Active"
      }
    })
  ]);

  await prisma.medicationAdministration.createMany({
    data: [
      {
        reference: "ADM-7101",
        orderId: ayandaMeds[0].id,
        patientId: ayanda.id,
        administeredBy: "Sr. Naledi Khumalo",
        administeredByRole: Role.nurse,
        administeredAt: new Date("2026-04-01T08:05:00"),
        status: "Given",
        notes: "Tolerated well."
      },
      {
        reference: "ADM-7102",
        orderId: ayandaMeds[1].id,
        patientId: ayanda.id,
        administeredBy: "Sr. Naledi Khumalo",
        administeredByRole: Role.nurse,
        administeredAt: new Date("2026-04-01T09:15:00"),
        status: "Given",
        notes: "Pain improved from 6/10 to 4/10."
      },
      {
        reference: "ADM-7103",
        orderId: pieterMeds[0].id,
        patientId: pieter.id,
        administeredBy: "Sr. Naledi Khumalo",
        administeredByRole: Role.nurse,
        administeredAt: new Date("2026-04-01T08:40:00"),
        status: "Given",
        notes: "No immediate adverse reaction."
      }
    ]
  });

  await prisma.labResult.createMany({
    data: [
      {
        reference: "LAB-8001",
        patientId: ayanda.id,
        provider: "Ampath",
        testName: "CBC + U&E",
        specimen: "Blood",
        collectedAt: new Date("2026-04-01T06:20:00"),
        reportedAt: new Date("2026-04-01T11:20:00"),
        resultSummary: "Hb 12.8 g/dL, WCC 7.2, creatinine 73, sodium 138, potassium 4.1. No critical flags.",
        abnormalFlag: "Normal",
        fileUrl: "https://www.ampath.co.za/your-lab-results",
        uploadedBy: "Sr. Naledi Khumalo",
        uploadedByRole: Role.nurse
      },
      {
        reference: "LAB-8002",
        patientId: pieter.id,
        provider: "Ampath",
        testName: "Troponin + lipogram",
        specimen: "Blood",
        collectedAt: new Date("2026-04-01T08:00:00"),
        reportedAt: new Date("2026-04-01T11:45:00"),
        resultSummary: "Troponin mildly elevated. Lipogram pending fasting repeat.",
        abnormalFlag: "Abnormal",
        fileUrl: "https://www.ampath.co.za/lab-results",
        uploadedBy: "Dr. Leila Naidoo",
        uploadedByRole: Role.doctor
      }
    ]
  });

  await prisma.theatreCase.createMany({
    data: [
      {
        reference: "THR-9001",
        patientId: nomvula.id,
        procedureName: "Emergency Caesarean section standby",
        specialty: "Obstetrics",
        surgeon: "Dr. A. Petersen",
        anaesthetist: "Dr. N. Moodley",
        theatreRoom: "Theatre 2",
        scheduledAt: new Date("2026-04-01T18:00:00"),
        urgency: "Urgent",
        status: "Awaiting workup",
        notes: "Booked as standby pending CTG review and obstetric reassessment."
      }
    ]
  });

  await prisma.transferRecord.createMany({
    data: [
      {
        reference: "TRN-9101",
        patientId: pieter.id,
        type: "Inter-hospital transfer",
        sourceFacility: "Centurion District Hospital",
        destinationFacility: "UbuntuCare Cardiac Stepdown",
        transportMode: "Ambulance",
        escortType: "ALS crew",
        reason: "Cardiology workup and angiogram planning",
        requestedBy: "Lerato Moletsane",
        status: "Received",
        eta: "Arrived 08:15"
      },
      {
        reference: "TRN-9102",
        patientId: ayanda.id,
        type: "Planned transport",
        sourceFacility: "Ward B7",
        destinationFacility: "Parktown Imaging Centre",
        transportMode: "Porter + wheelchair",
        escortType: "Nursing assistant",
        reason: "MRI slot booking",
        requestedBy: "Sr. Naledi Khumalo",
        status: "Booked",
        eta: "09:50"
      }
    ]
  });

  await prisma.documentRecord.createMany({
    data: [
      {
        reference: "DOC-9201",
        patientId: ayanda.id,
        category: "Sick note",
        title: "Medical certificate",
        body: "Ayanda Mokoena is unfit for work from 01 April 2026 to 03 April 2026 pending investigation and clinical review.",
        authorName: "Dr. Kabelo Maseko",
        authorRole: Role.doctor
      },
      {
        reference: "DOC-9202",
        patientId: pieter.id,
        category: "Transfer letter",
        title: "Cardiology transfer summary",
        body: "Transferred in for cardiac review. Previous ECG, troponin trend, and medication list attached electronically.",
        authorName: "Lerato Moletsane",
        authorRole: Role.admin
      },
      {
        reference: "DOC-9203",
        patientId: nomvula.id,
        category: "Theatre booking",
        title: "Obstetric theatre standby pack",
        body: "Theatre booking created with pre-op checklist, anaesthetic review, and blood availability request.",
        authorName: "Sipho Dlamini",
        authorRole: Role.admin
      }
    ]
  });

  await prisma.emailLog.createMany({
    data: [
      {
        reference: "EML-9301",
        patientId: ayanda.id,
        recipient: "hr@apexbrands.co.za",
        subject: "Medical certificate for Ayanda Mokoena",
        category: "Sick note",
        sentBy: "Dr. Kabelo Maseko",
        status: "Sent"
      },
      {
        reference: "EML-9302",
        patientId: pieter.id,
        recipient: "transfers@centuriondh.demo",
        subject: "Transfer summary received",
        category: "Transfer letter",
        sentBy: "Lerato Moletsane",
        status: "Sent"
      }
    ]
  });

  await prisma.arrivalRecord.createMany({
    data: [
      {
        reference: "ARR-9401",
        patientId: ayanda.id,
        patientName: ayanda.fullName,
        arrivalMode: "Private transport",
        source: "Self referral",
        triageColor: "Yellow",
        casualtyArea: "Casualty cubicle 3",
        handoverNotes: "Presented with severe headache and dizziness. No loss of consciousness.",
        broughtInAt: new Date("2026-04-01T05:55:00"),
        status: "Admitted to Ward B7",
        createdBy: "Lerato Moletsane"
      },
      {
        reference: "ARR-9402",
        patientId: nomvula.id,
        patientName: nomvula.fullName,
        arrivalMode: "Ambulance",
        source: "Claremont Women Clinic",
        triageColor: "Orange",
        casualtyArea: "Maternity triage",
        handoverNotes: "Transferred by EMS for obstetric review. Pain increasing.",
        broughtInAt: new Date("2026-04-01T10:10:00"),
        status: "In maternity assessment",
        createdBy: "Lerato Moletsane"
      },
      {
        reference: "ARR-9403",
        patientId: pieter.id,
        patientName: pieter.fullName,
        arrivalMode: "Inter-facility transfer",
        source: "Centurion District Hospital",
        triageColor: "Orange",
        casualtyArea: "Casualty resus",
        handoverNotes: "Transferred with chest pain history. ECG and referral letter uploaded.",
        broughtInAt: new Date("2026-04-01T08:15:00"),
        status: "In cardiac stepdown",
        createdBy: "Lerato Moletsane"
      }
    ]
  });

  console.log("Demo database seeded.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
