const plans = {
  free: { name: "Free Plan", maxVoters: 100, studentRange: "100" },
  micro: { name: "Micro Tier", maxVoters: 400, studentRange: "400" },
  small: { name: "Small Tier", maxVoters: 1000, studentRange: "1000" },
  medium: { name: "Medium Tier", maxVoters: 5000, studentRange: "5000" },
  large: { name: "Large Tier", maxVoters: 10000, studentRange: "10000" },
  enterprise: {
    name: "Enterprise Tier",
    maxVoters: Number.MAX_SAFE_INTEGER,
    studentRange: "10001",
  },
};

export const subscriptionTerms = {
  "1_month": { label: "1 Month", months: 1 },
  one_off_election: { label: "One-Off Election", months: null },
  "4_months": { label: "4 Months", months: 4 },
  "1_year": { label: "1 Year", months: 12 },
};

export const getPlanConfig = (planKey) => plans[planKey] || plans.free;

export const getSubscriptionTermConfig = (termKey) =>
  subscriptionTerms[termKey] || subscriptionTerms["1_month"];

export const calculateSubscriptionExpiry = ({ subscriptionTerm, startedAt }) => {
  const start = new Date(startedAt || Date.now());
  const term = getSubscriptionTermConfig(subscriptionTerm);

  if (term.months == null) {
    return null;
  }

  return new Date(
    Date.UTC(
      start.getUTCFullYear(),
      start.getUTCMonth() + term.months,
      start.getUTCDate(),
      start.getUTCHours(),
      start.getUTCMinutes(),
      start.getUTCSeconds(),
      start.getUTCMilliseconds()
    )
  );
};

export const syncSchoolSubscriptionState = (school, now = new Date()) => {
  if (!school) return school;

  if (
    school.subscriptionTerm === "one_off_election" &&
    school.oneOffElectionConsumed
  ) {
    school.subscriptionActive = false;
    return school;
  }

  if (school.subscriptionExpiresAt && school.subscriptionExpiresAt <= now) {
    school.subscriptionActive = false;
    return school;
  }

  school.subscriptionActive = true;
  return school;
};

export default plans;
