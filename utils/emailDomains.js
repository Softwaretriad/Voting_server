export const normalizeAllowedEmailDomains = (domains = []) => {
  if (!Array.isArray(domains)) {
    return [];
  }

  return [
    ...new Set(
      domains
        .map((domain) =>
          String(domain || "")
            .trim()
            .toLowerCase()
            .replace(/^@+/, "")
        )
        .filter(Boolean)
    ),
  ];
};

export const getEmailDomain = (email = "") => {
  const [, domain = ""] = String(email || "").trim().toLowerCase().split("@");
  return domain;
};

export const isValidEmailDomain = (domain = "") =>
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(
    String(domain || "").trim().toLowerCase()
  );

export const emailMatchesAllowedDomains = (email, domains = []) => {
  const emailDomain = getEmailDomain(email);
  const allowedDomains = normalizeAllowedEmailDomains(domains);
  return Boolean(emailDomain && allowedDomains.includes(emailDomain));
};
