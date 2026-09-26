const { formatAmount } = require("./formatAmount");

/**
 * Wraps data in a consistent success response envelope.
 *
 * @param {import('express').Response} res - Express response object.
 * @param {any} data - The data payload to send.
 * @param {Object} [meta={}] - Optional metadata to merge into the response.
 * @returns {import('express').Response} The Express response.
 */
function success(res, data, meta = {}) {
  return res.json({
    success: true,
    ...meta,
    data,
  });
}

/**
 * Converts any timestamp value to an ISO 8601 string.
 *
 * Handles:
 *   - Unix timestamps in seconds (number < 1e12)
 *   - Unix timestamps in milliseconds (number >= 1e12)
 *   - Stellar date strings (e.g. "2024-07-01T12:00:00Z")
 *   - JavaScript Date objects
 *   - Falsy values → null
 *
 * @param {string|number|Date|null|undefined} value - The timestamp to format.
 * @returns {string|null} ISO 8601 string or null when value is falsy.
 */
function toISOTimestamp(value) {
  if (!value && value !== 0) return null;
  const ms = typeof value === "number" && value < 1e12 ? value * 1000 : value;
  return new Date(ms).toISOString();
}

/** @deprecated Use toISOTimestamp instead */
const formatTimestamp = toISOTimestamp;

/**
 * Strips unnecessary Horizon _links fields from a record.
 *
 * @param {Object|null|undefined} obj - The object to clean.
 * @returns {Object|null|undefined} The object without _links or the original value if invalid.
 */
function stripLinks(obj) {
  if (!obj || typeof obj !== "object") return obj;
  const { _links, ...rest } = obj;
  return rest;
}

const AMOUNT_KEYS = new Set([
  "amount",
  "balance",
  "startingbalance",
  "sourceamount",
  "destinationamount",
  "baseamount",
  "counteramount",
  "totalamount",
  "buyingliabilities",
  "sellingliabilities",
  "price",
  "priceinxlm",
  "effectiverate",
  "fee",
  "feecharged",
  "feepool",
  "basefeeinxlm",
  "basereserveinxlm",
  "maxinxlm",
  "xlm",
]);

function shouldNormalizeAmountKey(key, value) {
  if (value === null || value === undefined) return false;
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "bigint") {
    return false;
  }

  const normalizedKey = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
  if (!normalizedKey) return false;
  if (normalizedKey.includes("stroop")) return false;
  if (normalizedKey === "feebp" || normalizedKey === "pricenumerator" || normalizedKey === "pricedenominator") {
    return false;
  }

  return (
    AMOUNT_KEYS.has(normalizedKey) ||
    normalizedKey.endsWith("amount") ||
    normalizedKey.endsWith("balance") ||
    normalizedKey.endsWith("price") ||
    normalizedKey.endsWith("fee") ||
    normalizedKey.endsWith("liabilities")
  );
}

function normalizeAmountFields(value) {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeAmountFields(item));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const normalized = {};
  for (const [key, entry] of Object.entries(value)) {
    if (shouldNormalizeAmountKey(key, entry)) {
      normalized[key] = formatAmount(entry);
    } else {
      normalized[key] = normalizeAmountFields(entry);
    }
  }
  return normalized;
}

module.exports = {
  success,
  toISOTimestamp,
  formatTimestamp,
  stripLinks,
  normalizeAmountFields,
};
