import type { Role } from "@prisma/client";

export const SESSION_COOKIE = "ubuntu-care-sa-session";

export const hospitalMeta = {
  name: "UbuntuCare Private Hospital",
  city: "Johannesburg",
  province: "Gauteng",
  tagline:
    "Paperless South African hospital operations for casualty, wards, theatre, radiology, labs, transport, and admin.",
  emergencyNumbers: ["112", "10177"],
  switchboard: "+27 10 555 0180",
  supportEmail: "hello@ubuntucare.demo",
  campuses: ["Rosebank Main Campus", "Parktown Imaging Centre", "Midrand Day Theatre"],
  sectors: [
    "Admissions",
    "Casualty",
    "Ward",
    "Radiology",
    "Laboratory",
    "Theatre",
    "Transport",
    "Billing"
  ]
};

export const provinces = [
  "Eastern Cape",
  "Free State",
  "Gauteng",
  "KwaZulu-Natal",
  "Limpopo",
  "Mpumalanga",
  "Northern Cape",
  "North West",
  "Western Cape"
];

export const languages = [
  "English",
  "Afrikaans",
  "isiZulu",
  "isiXhosa",
  "Sesotho",
  "Setswana",
  "Xitsonga",
  "Tshivenda"
];

export const maritalStatuses = [
  "Single",
  "Married",
  "Divorced",
  "Widowed",
  "Separated",
  "Domestic partnership"
];

export const arrivalModes = [
  "Walk-in",
  "Private transport",
  "Ambulance",
  "Inter-facility transfer",
  "Clinic referral"
];

export const contactMethods = ["Phone call", "SMS", "WhatsApp", "Email"];

export const triageLevels = [
  "Green",
  "Yellow",
  "Orange",
  "Red"
];

export const medicalAidSchemes = [
  "Discovery Health Medical Scheme",
  "Bonitas Medical Fund",
  "Momentum Medical Scheme",
  "Medihelp",
  "Fedhealth",
  "Bestmed",
  "Self-pay / cash patient"
];

export const departments = [
  "Admissions",
  "Casualty",
  "Ward B7",
  "Ward C4",
  "Radiology",
  "Laboratory",
  "General Medicine",
  "Cardiology",
  "Neurology",
  "Pediatrics",
  "Maternity",
  "Theatre",
  "Billing",
  "Transport"
];

export const appointmentTypes = [
  "General consultation",
  "MRI Brain Review",
  "Cardiology Consultation",
  "Ward review",
  "Maternity follow-up",
  "Pre-admission verification",
  "Discharge planning"
];

export const appointmentStatuses = [
  "Requested",
  "Pending verification",
  "Confirmed",
  "Checked in",
  "In progress",
  "Completed",
  "Rescheduled"
];

export const channels = [
  "Admissions",
  "Radiology",
  "Ward",
  "Theatre",
  "Billing",
  "Casualty",
  "Laboratory",
  "Transfers"
] as const;

export const taskStatuses = ["Queued", "In progress", "Blocked", "Done"] as const;
export const taskPriorities = ["Low", "Standard", "High", "Critical"] as const;
export const scanModalities = ["MRI", "CT", "X-Ray", "Ultrasound"] as const;
export const labProviders = ["Ampath", "Lancet", "NHLS", "In-house"] as const;
export const medicationRoutes = ["Oral", "IV", "IM", "Subcutaneous", "Topical"] as const;
export const transferTypes = ["Inter-hospital transfer", "Planned transport", "Discharge transport"] as const;
export const theatreStatuses = ["Booked", "Awaiting workup", "In theatre", "Completed", "Postponed"] as const;
export const documentCategories = [
  "Admission pack",
  "Consent form",
  "Sick note",
  "Discharge summary",
  "Referral letter",
  "Transfer letter",
  "Theatre booking",
  "Lab release"
] as const;

export const roleLabelMap: Record<Role, string> = {
  patient: "Patient",
  doctor: "Doctor",
  nurse: "Nurse",
  admin: "Admin"
};

export const staffDirectory = [
  {
    id: "staff-1",
    name: "Dr. Leila Naidoo",
    title: "Consultant Radiologist",
    department: "Radiology",
    specialization: "MRI, CT, neuroradiology",
    image: "https://randomuser.me/api/portraits/women/44.jpg",
    phone: "+27 10 555 0201",
    email: "leila.naidoo@ubuntucare.demo"
  },
  {
    id: "staff-2",
    name: "Dr. Kabelo Maseko",
    title: "Cardiology Consultant",
    department: "Cardiology",
    specialization: "Heart failure, ICU review",
    image: "https://randomuser.me/api/portraits/men/32.jpg",
    phone: "+27 10 555 0202",
    email: "kabelo.maseko@ubuntucare.demo"
  },
  {
    id: "staff-3",
    name: "Sr. Naledi Khumalo",
    title: "Ward Unit Manager",
    department: "Ward B7",
    specialization: "Medication administration, patient monitoring",
    image: "https://randomuser.me/api/portraits/women/68.jpg",
    phone: "+27 10 555 0210",
    email: "naledi.khumalo@ubuntucare.demo"
  },
  {
    id: "staff-4",
    name: "Sipho Dlamini",
    title: "Admissions Supervisor",
    department: "Admissions",
    specialization: "Funding, transfers, transport coordination",
    image: "https://randomuser.me/api/portraits/men/75.jpg",
    phone: "+27 10 555 0220",
    email: "sipho.dlamini@ubuntucare.demo"
  }
];
