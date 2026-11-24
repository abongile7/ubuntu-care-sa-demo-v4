export const domains={
 IDENTITY:{label:"Identity verification",operation:"verify-claimed-identity",roles:["admin"],providers:["DHA / authorized identity provider"],scenarios:["MATCH","NO_MATCH","UNAVAILABLE"]},
 MEDICAL_AID:{label:"Medical aid",operation:"eligibility-authorisation-claim",roles:["admin","billing"],providers:["Certified switch","Medical scheme administrator"],scenarios:["ACCEPTED","REJECTED","NEEDS_INFORMATION","UNAVAILABLE"]},
 EMS:{label:"Ambulance",operation:"pre-alert-handover",roles:["admin","paramedic","nurse"],providers:["EMS provider"],scenarios:["ACKNOWLEDGED","DUPLICATE","UNAVAILABLE"]},
 REFERRAL:{label:"Hospital interoperability",operation:"referral-transfer",roles:["admin","doctor","nurse"],providers:["Sending / receiving hospital"],scenarios:["ACKNOWLEDGED","PATIENT_MISMATCH","UNAVAILABLE"]},
 LAB:{label:"Laboratory",operation:"order-result-acknowledgement",roles:["doctor","nurse","admin"],providers:["Pathology provider"],scenarios:["RESULT_READY","CORRECTED_RESULT","CRITICAL_RESULT_PENDING_REVIEW","UNAVAILABLE"]},
 IMAGING:{label:"Radiology",operation:"imaging-report",roles:["doctor","nurse","admin"],providers:["RIS / PACS vendor"],scenarios:["REPORT_READY","UNAVAILABLE"]},
 PHARMACY:{label:"Pharmacy",operation:"dispensing-status",roles:["doctor","nurse","admin"],providers:["Hospital pharmacy system"],scenarios:["DISPENSED","OUT_OF_STOCK","REVIEW_REQUIRED","UNAVAILABLE"]},
 SIGNATURE:{label:"Electronic signature",operation:"signature-evidence",roles:["admin","doctor"],providers:["Approved signature provider"],scenarios:["SIGNED","DECLINED","EXPIRED","UNAVAILABLE"]},
 COMMUNICATIONS:{label:"Communications",operation:"call-message-delivery",roles:["admin","doctor"],providers:["Approved telecom provider"],scenarios:["DELIVERED","FAILED","UNAVAILABLE"]}
} as const;
export type Domain=keyof typeof domains;
export function simulate(domain:Domain,scenario:string,requestId:string){
 return {environment:"SYNTHETIC_ONLY",simulation:true,domain,operation:domains[domain].operation,requestId,scenario,providerConnected:false,clinicalRecordChanged:false,receivedAt:new Date().toISOString()};
}
