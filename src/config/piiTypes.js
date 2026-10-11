// The full set of sensitive-data types the redaction pipeline knows how to
// detect (src/services/pii/detectors.js) and that an API key's `piiTypes`
// list is validated against (see admin.routes.js and apiKey.service.js).
export const PII_TYPES = ["EMAIL", "PHONE_IN", "CARD", "AADHAAR", "PAN", "SECRET"];
