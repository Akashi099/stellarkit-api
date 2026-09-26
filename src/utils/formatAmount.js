/**
 * Normalizes Stellar amount-like values to a fixed seven-decimal string.
 *
 * Accepts Horizon-style decimal strings, numbers, or bigint values.
 * Returns the original value unchanged when it is blank or not numeric.
 *
 * @param {string|number|bigint|null|undefined} value
 * @returns {string|number|bigint|null|undefined}
 */
function formatAmount(value) {
  if (value === null || value === undefined || value === "") {
    return value;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value.toFixed(7) : value;
  }

  if (typeof value === "bigint") {
    return `${value.toString()}.0000000`;
  }

  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return value;
  }

  const match = trimmed.match(/^([+-]?)(\d+)(?:\.(\d+))?$/);
  if (!match) {
    const numeric = Number(trimmed);
    return Number.isFinite(numeric) ? numeric.toFixed(7) : value;
  }

  const [, sign, rawWhole, rawFraction = ""] = match;
  const rounded = roundFraction(rawWhole, rawFraction, 7);
  const prefix = sign === "-" && !isZeroAmount(rounded.whole, rounded.fraction) ? "-" : "";
  return `${prefix}${rounded.whole}.${rounded.fraction}`;
}

function isZeroAmount(whole, fraction) {
  return /^0+$/.test(whole) && /^0+$/.test(fraction);
}

function roundFraction(whole, fraction, scale) {
  if (fraction.length <= scale) {
    return {
      whole,
      fraction: fraction.padEnd(scale, "0"),
    };
  }

  const digits = `${whole}${fraction.slice(0, scale)}`;
  let combined = BigInt(digits || "0");
  if (Number(fraction.charAt(scale)) >= 5) {
    combined += 1n;
  }

  const combinedString = combined.toString().padStart(scale + 1, "0");
  const wholePart = combinedString.slice(0, -scale) || "0";
  const fractionPart = combinedString.slice(-scale).padStart(scale, "0");

  return {
    whole: wholePart,
    fraction: fractionPart,
  };
}

module.exports = { formatAmount };
