/**
 * Memo decoding utilities for Stellar memos.
 */
function decodeBase64ToUtf8(value) {
  try {
    return Buffer.from(value, "base64").toString("utf8");
  } catch (e) {
    throw new Error("Invalid base64 value for text memo");
  }
}

function decodeBase64ToHex(value) {
  try {
    return Buffer.from(value, "base64").toString("hex");
  } catch (e) {
    throw new Error("Invalid base64 value for hash/return memo");
  }
}

/**
 * Decode a raw memo value for the given Stellar memo type.
 *
 * @param {string} type - one of: none, text, id, hash, return
 * @param {string|undefined} value - raw memo value as returned by Horizon (usually base64 for text/hash/return, decimal string for id)
 * @returns {{type:string, raw: string|null, decoded: string|null, description: string}}
 */
function decodeMemo(type, value) {
  if (!type) {
    const err = new Error("Missing memo type");
    err.isValidation = true;
    throw err;
  }

  const t = String(type).toLowerCase();

  const descriptions = {
    none: "No memo attached to the transaction.",
    text: "Plain text memo",
    id: "Unsigned 64-bit integer memo used for references",
    hash: "32-byte hash memo (hex) commonly used for transaction references",
    return: "32-byte hash memo (hex) used as a return address",
  };

  if (!Object.prototype.hasOwnProperty.call(descriptions, t)) {
    const err = new Error(`Unsupported memo type: ${type}`);
    err.isValidation = true;
    throw err;
  }

  if (t === "none") {
    return { type: "none", raw: null, decoded: null, description: descriptions.none };
  }

  if (t === "text") {
    if (typeof value !== "string") {
      const err = new Error("Missing memo value for text type");
      err.isValidation = true;
      throw err;
    }
    const decoded = decodeBase64ToUtf8(value);
    return { type: "text", raw: value, decoded, description: descriptions.text };
  }

  if (t === "id") {
    if (typeof value !== "string") {
      const err = new Error("Missing memo value for id type");
      err.isValidation = true;
      throw err;
    }
    // Ensure it's a decimal string (unsigned 64-bit). We keep as string to avoid precision loss.
    if (!/^[0-9]+$/.test(value)) {
      const err = new Error("Invalid id memo value; expected unsigned integer string");
      err.isValidation = true;
      throw err;
    }
    return { type: "id", raw: value, decoded: value, description: descriptions.id };
  }

  // hash or return - Horizon provides base64; present hex to developers
  if (t === "hash" || t === "return") {
    if (typeof value !== "string") {
      const err = new Error(`Missing memo value for ${t} type`);
      err.isValidation = true;
      throw err;
    }
    const decoded = decodeBase64ToHex(value);
    return { type: t, raw: value, decoded, description: descriptions[t] };
  }

  // Should not reach here
  const err = new Error(`Unsupported memo type: ${type}`);
  err.isValidation = true;
  throw err;
}

/**
 * Validate a caller-provided memo value and report its encoded byte length.
 * Hash and return values use hexadecimal strings, matching decodeMemo output.
 */
function validateMemo(type, value) {
  const normalizedType = typeof type === "string" ? type.toLowerCase() : "";
  const errors = [];
  let byteLength = 0;

  if (!["text", "id", "hash", "return"].includes(normalizedType)) {
    errors.push("Memo type must be one of: text, id, hash, return.");
  } else if (typeof value !== "string") {
    errors.push("Memo value must be a string.");
  } else if (normalizedType === "text") {
    byteLength = Buffer.byteLength(value, "utf8");
    if (byteLength > 28) {
      errors.push(`Text memo exceeds the 28-byte limit (received ${byteLength} bytes).`);
    }
  } else if (normalizedType === "id") {
    byteLength = /^[0-9]+$/.test(value) ? 8 : 0;
    if (!/^[0-9]+$/.test(value)) {
      errors.push("ID memo must be an unsigned 64-bit integer in decimal form.");
    } else if (BigInt(value) > 18446744073709551615n) {
      errors.push("ID memo must be within the unsigned 64-bit integer range.");
    }
  } else {
    const isHex = /^[0-9a-fA-F]+$/.test(value) && value.length % 2 === 0;
    byteLength = isHex ? value.length / 2 : 0;
    if (!isHex || byteLength !== 32) {
      errors.push(`${normalizedType === "hash" ? "Hash" : "Return"} memo must be exactly 32 bytes (64 hexadecimal characters).`);
    }
  }

  return {
    valid: errors.length === 0,
    type: normalizedType || type || null,
    value: value ?? null,
    byteLength,
    errors,
  };
}

module.exports = { decodeMemo, validateMemo };
