// Checksum algorithms used to tell a real card/Aadhaar number apart from an
// arbitrary same-length number (e.g. an order ID). Both take a digit-only
// string and only look at the digits themselves - no formatting, no length
// enforcement (callers check length before calling these).

// Luhn checksum (credit/debit cards): from the rightmost digit, double
// every second digit; if doubling pushes it over 9, subtract 9 (same as
// summing its own two digits). Valid when the total sum is a multiple of 10.
export function luhnValid(digits) {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    // i=0 is the rightmost digit (the check digit itself, never doubled).
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

// Verhoeff checksum (used by Aadhaar): a more robust alternative to Luhn
// that also catches adjacent-digit transpositions. Needs three fixed lookup
// tables - multiplication (d), permutation (p), and inverse (not used here,
// only needed for *generating* a check digit, not validating one).
const D_TABLE = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];

const P_TABLE = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

// Processes digits right-to-left (index 0 = rightmost), running them through
// the permutation table (cycling through its 8 rows) and the multiplication
// table. Valid when the final running total is 0.
export function verhoeffValid(digits) {
  let c = 0;
  const reversed = digits.split("").map(Number).reverse();
  for (let i = 0; i < reversed.length; i++) {
    c = D_TABLE[c][P_TABLE[i % 8][reversed[i]]];
  }
  return c === 0;
}
