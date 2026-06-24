export const getPagination = (query = {}, { defaultLimit = 50, maxLimit = 100 } = {}) => {
  const page = Math.max(Number(query.page || 1), 1);
  const requestedLimit = Number(query.limit || defaultLimit);
  const limit = Math.min(Math.max(requestedLimit, 1), maxLimit);
  const skip = (page - 1) * limit;
  const enabled =
    query.page != null ||
    query.limit != null ||
    String(query.paginate || "").toLowerCase() === "true";

  return { enabled, page, limit, skip };
};

export const buildPaginationMeta = ({ page, limit, total }) => ({
  page,
  limit,
  total,
  totalPages: limit > 0 ? Math.ceil(total / limit) : 0,
});
