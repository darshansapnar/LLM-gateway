// Mirrors src/config/piiTypes.js on the backend - the dashboard is a
// separate app (own package.json/node_modules) so it can't import that
// file directly. Keep this list in sync with it.
export const PII_TYPES = ["EMAIL", "PHONE_IN", "CARD", "AADHAAR", "PAN", "SECRET"];
