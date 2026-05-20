export const defaultNotificationPreferences = {
  notificationsEnabled: true,
  electionAlertsEnabled: true,
  resultsEnabled: true,
  announcementsEnabled: true,
  voterActivityEnabled: true,
};

const electionAlertTypes = new Set([
  "election_scheduled",
  "election_starting_soon",
  "election_is_now_live",
  "election_went_live",
  "election_closing_soon",
  "election_closed",
]);

const resultsTypes = new Set([
  "results_published",
  "results_generated",
  "results_report_ready",
]);

const voterActivityTypes = new Set([
  "vote_cast_successfully",
  "category_vote_already_completed",
  "student_turnout_milestone",
  "suspicious_voting_activity",
]);

export const normalizeNotificationPreferences = (preferences = {}) => ({
  ...defaultNotificationPreferences,
  ...(preferences || {}),
});

export const getNotificationPreferenceKey = (type) => {
  if (electionAlertTypes.has(type)) {
    return "electionAlertsEnabled";
  }

  if (resultsTypes.has(type)) {
    return "resultsEnabled";
  }

  if (voterActivityTypes.has(type)) {
    return "voterActivityEnabled";
  }

  return "announcementsEnabled";
};

export const canDeliverNotification = ({ preferences, type }) => {
  const resolvedPreferences = normalizeNotificationPreferences(preferences);

  if (!resolvedPreferences.notificationsEnabled) {
    return false;
  }

  const preferenceKey = getNotificationPreferenceKey(type);
  return Boolean(resolvedPreferences[preferenceKey]);
};
