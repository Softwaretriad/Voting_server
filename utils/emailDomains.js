export const normalizeAllowedEmailDomains = (domains = []) => {
  const domainList = Array.isArray(domains)
    ? domains
    : String(domains || "")
        .split(",")
        .map((domain) => domain.trim());

  return [
    ...new Set(
      domainList
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
