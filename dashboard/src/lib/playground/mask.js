// Masks a secret for display (API key in the Headers table, Raw tab,
// History) - keeps a few characters on each end so the user can still tell
// keys apart, hides the rest. Never used for the value actually sent.
export function maskSecret(value) {
  if (!value) return "";
  if (value.length <= 6) return "•".repeat(value.length);
  const visible = 4;
  const hiddenLength = Math.max(6, value.length - visible * 2);
  return `${value.slice(0, visible)}${"•".repeat(hiddenLength)}${value.slice(-visible)}`;
}
