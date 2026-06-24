export const STUDENT_ROLE = "student";
export const EC_ROLE = "ec";

export const EC_ACCOUNT_ROLES = [EC_ROLE];
export const EC_RECIPIENT_TYPES = [EC_ROLE];
export const EC_ACTOR_TYPES = [EC_ROLE];

export const isEcRole = (role) => EC_ACCOUNT_ROLES.includes(String(role || "").trim());

export const isEcAccountRole = (role) => isEcRole(role);

export const normalizeEcRole = (role) =>
  isEcRole(role) ? EC_ROLE : String(role || "").trim();

export const ecRoleQuery = () => ({ $in: EC_ACCOUNT_ROLES });

export const ecRecipientTypeQuery = () => ({ $in: EC_RECIPIENT_TYPES });

export const normalizeRecipientType = (recipientType) =>
  EC_RECIPIENT_TYPES.includes(String(recipientType || "").trim())
    ? EC_ROLE
    : String(recipientType || "").trim();

export const normalizeActorType = (actorType) =>
  EC_ACTOR_TYPES.includes(String(actorType || "").trim())
    ? EC_ROLE
    : String(actorType || "").trim();
