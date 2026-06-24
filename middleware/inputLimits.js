import { sendError } from "../utils/apiResponse.js";

const defaultStringLimit = Number(process.env.INPUT_DEFAULT_MAX_LENGTH) || 2000;
const maxDepth = Number(process.env.INPUT_MAX_DEPTH) || 10;
const maxObjectKeys = Number(process.env.INPUT_MAX_OBJECT_KEYS) || 200;

const stringLimits = new Map(
  Object.entries({
    firstname: 80,
    lastname: 80,
    name: 160,
    title: 200,
    shortname: 40,
    fullname: 200,
    studentid: 80,
    phone: 32,
    phonenumber: 32,
    gender: 16,
    email: 254,
    password: 128,
    newpassword: 128,
    votingpin: 4,
    newpin: 4,
    otp: 12,
    department: 160,
    universityfullname: 200,
    programofstudy: 200,
    programmeofstudy: 200,
    faculty: 160,
    electoralcategory: 160,
    description: 3000,
    message: 2000,
    imageurl: 2048,
    logourl: 2048,
    voterlisturl: 2048,
    aspirantlisturl: 2048,
    clientkey: 128,
    electionclientkey: 128,
    draftclientkey: 128,
    token: 8192,
    accesstoken: 8192,
    refreshtoken: 8192,
    resettoken: 256,
    bootstrapkey: 256,
    deviceid: 256,
    platform: 32,
    startdate: 64,
    enddate: 64,
    subscriptionstartedat: 64,
    status: 32,
    plan: 32,
    subscriptionterm: 32,
  })
);

const arrayLimits = new Map(
  Object.entries({
    voters: 100000,
    aspirants: 100000,
    members: 10000,
    faculties: 1000,
    programmes: 2000,
    categories: 500,
    allowedemaildomains: 100,
  })
);

const getStringLimit = (key) =>
  stringLimits.get(String(key || "").toLowerCase()) || defaultStringLimit;

const getArrayLimit = (key) =>
  arrayLimits.get(String(key || "").toLowerCase()) ||
  Number(process.env.INPUT_DEFAULT_MAX_ARRAY_ITEMS) ||
  1000;

const inspectValue = (value, key, path, depth) => {
  if (depth > maxDepth) {
    return `${path} exceeds the maximum nesting depth of ${maxDepth}`;
  }

  if (typeof value === "string") {
    const limit = getStringLimit(key);
    return value.length > limit
      ? `${path} must be ${limit} characters or fewer`
      : null;
  }

  if (Array.isArray(value)) {
    const limit = getArrayLimit(key);
    if (value.length > limit) {
      return `${path} must contain ${limit} items or fewer`;
    }

    for (let index = 0; index < value.length; index += 1) {
      const error = inspectValue(value[index], key, `${path}[${index}]`, depth + 1);
      if (error) return error;
    }
    return null;
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value);
    if (entries.length > maxObjectKeys) {
      return `${path} must contain ${maxObjectKeys} fields or fewer`;
    }

    for (const [childKey, childValue] of entries) {
      const childPath = path ? `${path}.${childKey}` : childKey;
      const error = inspectValue(childValue, childKey, childPath, depth + 1);
      if (error) return error;
    }
  }

  return null;
};

export const enforceInputLimits = (req, res, next) => {
  const error =
    inspectValue(req.body, "body", "body", 0) ||
    inspectValue(req.query, "query", "query", 0) ||
    inspectValue(req.params, "params", "params", 0);
  return error ? sendError(res, 413, error) : next();
};
