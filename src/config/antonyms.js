// Word pairs that flip the meaning of an otherwise near-identical question
// (e.g. "how do I start a server" vs "how do I stop a server"). Used by
// cacheVerifier.service.js's antonym guard to reject semantic-cache
// candidates that are similar in WORDING but opposite in MEANING - pure
// embedding similarity alone doesn't reliably catch these (see the eval).
//
// Each entry is a single pair; order doesn't matter (checked both ways).
// "un-"/"dis-" prefix pairs (lock/unlock, enable/disable) are handled
// automatically in cacheVerifier.service.js and don't need to be listed here.
export const ANTONYM_PAIRS = [
  ["on", "off"],
  ["start", "stop"],
  ["increase", "decrease"],
  ["enable", "disable"],
  ["add", "remove"],
  ["open", "close"],
  ["lock", "unlock"],
  ["connect", "disconnect"],
  ["merge", "split"],
  ["largest", "smallest"],
  ["fastest", "slowest"],
  ["hottest", "coldest"],
  ["oldest", "newest"],
  ["tallest", "shortest"],
  ["up", "down"],
  ["push", "pull"],
  ["begin", "end"],
  ["more", "less"],
  ["max", "min"],
  ["maximum", "minimum"],
  ["highest", "lowest"],
  ["best", "worst"],
  ["first", "last"],
  ["before", "after"],
  ["expand", "collapse"],
  ["show", "hide"],
  ["allow", "block"],
  ["grant", "revoke"],
  ["install", "uninstall"],
  ["upgrade", "downgrade"],
];
