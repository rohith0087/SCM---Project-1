/** Shared Study 1 / Study 2 materials from the September 18 revised design. */
export const MATERIALS_VERSION = "2.0.0";
export const HEADER = "You are a regional operations manager for a national package delivery company. A female customer has submitted a complaint about one of your drivers, and you need to evaluate the driver's performance.";
export const IDENTITIES = [
  { id: "jamal", label: "Jamal Washington" },
  { id: "connor", label: "Connor Mitchell" },
  { id: "taylor", label: "Taylor Reeves" },
];
export const BEHAVIORS = [
  { id: "boundary", label: "Boundary-setting" },
  { id: "compliant", label: "Compliant" },
];
export const ESCALATIONS = [
  { id: "routine", label: "Routine" },
  { id: "escalated", label: "Escalated" },
];
export const COMPLAINTS: Record<string, string> = {
  routine: "Your driver was unprofessional during a delivery. I came outside to ask a question about the package, and the interaction felt tense and uncomfortable. I want this driver removed from my route.",
  escalated: "Your driver was on my property, and I didn't feel comfortable with how the interaction went. I ended up calling the police because I didn't feel safe letting them leave until I could confirm who they were. I want this driver removed from my route.",
};
export const REPORTS: Record<string, Record<string, string>> = {
  routine: {
    boundary: "The customer came outside and started questioning me aggressively, asking for my ID and whether I actually worked here. I started recording because I needed documentation in case the situation escalated. When they asked me to stop, I told them I wasn't going to and kept recording until I was back in my van. I did my job and I'm not going to apologize for protecting myself.",
    compliant: "The customer came outside with questions about the delivery. I didn't want to make things worse, so I didn't record anything, even though I felt uneasy. I tried to reassure them and finish the delivery as quickly and politely as I could. I should have been more careful about how I came across from the start.",
  },
  escalated: {
    boundary: "The customer accused me of being suspicious for doing my job and blocked my van with their car. I started recording because I was worried about what might happen and wanted proof of what was going on. When they told me to stop, I kept recording anyway, all the way until the police arrived and confirmed I was doing a legitimate delivery. I wasn't going to stop protecting myself just because they didn't like it.",
    compliant: "The customer seemed uneasy about me being there and blocked my van with their car. I didn't record anything because I didn't want to make things worse. I waited quietly until the police arrived and confirmed everything was fine. I probably should have tried to reassure the customer sooner instead of just waiting it out.",
  },
};
export const RATINGS = [
  { id: "performance_rating", label: "Overall performance", question: "How would you rate this driver's overall performance in this situation?", low: "Completely unacceptable", high: "Exemplary" },
  { id: "disciplinary_likelihood", label: "Disciplinary likelihood", question: "How likely are you to recommend formal disciplinary action for this driver?", low: "Not at all likely", high: "Extremely likely" },
  { id: "attribution_driver", label: "Attribution to driver", question: "To what extent was this outcome caused by the driver's choices and attitude?", low: "Not at all", high: "Completely" },
  { id: "attribution_context", label: "Attribution to context", question: "To what extent was this outcome caused by the situation and context?", low: "Not at all", high: "Completely" },
  { id: "retention_likelihood", label: "Retention likelihood", question: "If you were making staffing decisions, how likely would you be to retain this driver on your team?", low: "Definitely would not retain", high: "Definitely would retain" },
  { id: "customer_focus", label: "Customer focus", question: "How customer-focused is this driver?", low: "Not at all customer-focused", high: "Extremely customer-focused" },
  { id: "operational_risk", label: "Operational/service continuity risk", question: "How much risk do you think this incident creates for maintaining reliable service on this route, such as delayed or missed deliveries or account attrition?", low: "No risk at all", high: "Extreme risk" },
];
export const SCENARIO_TEMPLATE = `${HEADER}\n\nCUSTOMER COMPLAINT:\n"{{complaint}}"\n\nDRIVER: {{driver_name}}\n\nDRIVER'S INCIDENT REPORT:\n"{{driver_report}}"`;
export const RATING_PROMPT = RATINGS.map((r, i) => `${i + 1}. ${r.question} (1 = ${r.low}, 7 = ${r.high})`).join("\n\n");

/** Reviewable survey materials, not a claim to be an importable Qualtrics QSF. */
export function humanMaterials() {
  return {
    version: MATERIALS_VERSION,
    scope: "Female customer fixed across conditions; categorical employment decision omitted.",
    targetSample: { total: 480, perCell: 40, pilot: "20–30" },
    eligibility: ["U.S.-based", "Currently employed in supply chain, logistics, operations, or general management", "Supervises or has supervised frontline workers"],
    ratings: RATINGS,
    conditions: IDENTITIES.flatMap(identity => ESCALATIONS.flatMap(escalation => BEHAVIORS.map(behavior => ({
      id: `identity=${identity.id}|behavior=${behavior.id}|escalation=${escalation.id}`,
      identity: identity.id, behavior: behavior.id, escalation: escalation.id,
      header: HEADER, driver: identity.label, complaint: COMPLAINTS[escalation.id], report: REPORTS[escalation.id][behavior.id],
      checks: {
        recorded: { question: "Did the driver record the interaction on their phone?", options: ["Yes", "No"], expected: behavior.id === "boundary" ? "Yes" : "No" },
        police: { question: "Did the customer contact the police during this incident?", options: ["Yes", "No"], expected: escalation.id === "escalated" ? "Yes" : "No" },
        recall: escalation.id === "routine"
          ? { question: "In the scenario you just read, what was the primary customer complaint?", options: ["The driver delivered to the wrong address", "The interaction felt tense and unprofessional", "The driver was late with the delivery", "The driver damaged the package"], expected: "The interaction felt tense and unprofessional" }
          : { question: "In the scenario you just read, what did the customer do?", options: ["Delivered feedback to corporate", "Called the police", "Left a voicemail", "Requested a refund"], expected: "Called the police" },
      },
    })))),
    attentionCheck: { placement: "early", question: "This is an attention check. Please select 'Strongly Agree' for this item.", expected: "Strongly Agree" },
    identityCheck: { placement: "end", question: "What race or ethnicity do you believe the driver in this scenario is?", options: ["White/Caucasian", "Black/African American", "Hispanic/Latino", "Asian/Pacific Islander", "Other", "Prefer not to answer"], unresolved: "The document expects Not sure responses but omits that option. Finalize before fielding." },
    pending: ["Independent Taylor Reeves name pretest", "Linguistic review of scenario wording", "Finalize identity response options and exclusion rules", "Configure and validate balanced randomization in Qualtrics", "Human pilot and preregistration"],
    importColumns: ["participant_id", "condition_id", "identity", "behavior", "escalation", ...RATINGS.map(r => r.id), "recorded_check", "police_check", "recall_check", "imc_check", "perceived_identity"],
  };
}
