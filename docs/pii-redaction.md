# PII redaction

## The problem, in simple words

People paste real, sensitive stuff into prompts - an email address, a card
number, a phone number. Before this feature, the gateway stored prompts
and answers exactly as-is: in the Redis cache, in MongoDB's `RequestLog`,
everywhere. That real card number or email would just sit there in plain
text, indefinitely.

PII redaction fixes that: before a prompt leaves the gateway, it's scanned
for a known list of sensitive data types. Anything found gets swapped for
a placeholder like `[EMAIL_1]` before the provider, the cache, or the
database ever see it. The caller still gets their real values back in the
response (if they want them) - only the *provider and the storage layer*
only ever see the masked version.

## How it works (with an example)

Say someone sends this prompt:

```
My card is 4111 1111 1111 1111, email me at jane@example.com,
or just call 9876543210.
```

```
 1. Detect                finds: CARD, EMAIL, PHONE_IN
        │
        ▼
 2. Mask                   "My card is [CARD_1], email me at [EMAIL_1],
                            or just call [PHONE_IN_1]."
        │
        ▼
 3. Send to the provider   Groq/Gemini only ever sees the MASKED text above -
    (Groq / Gemini)        never the real card number, email, or phone number.
        │
        ▼
 4. Provider answers       "Got it - I'll use [CARD_1] and reach you at
    (using placeholders)   [EMAIL_1] or [PHONE_IN_1]."
        │
        ▼
 5. Cache + log            Both the exact/semantic cache AND MongoDB's
    (still masked)         RequestLog store the MASKED prompt and answer -
                            never the real values, from step 2 onward.
        │
        ▼
 6. Restore (if enabled)   The gateway swaps the placeholders back to the
                            REAL values - but only in the copy sent back
                            to this same caller, never in what got cached/logged.
        │
        ▼
 7. What the caller sees   "Got it - I'll use 4111 1111 1111 1111 and
                            reach you at jane@example.com or 9876543210."
```

The important part: steps 3-5 (the provider call, the cache, the
database) only ever touch the masked text from step 2. The real values
only ever exist again in step 6-7, and only for the person who sent them
in the first place.

## Detectors

`src/services/pii/detectors.js` looks for six types. It's plain regex +
checksum math - not an AI model - so it's fast, free, and either finds a
match or it doesn't (no "maybe" scores to tune).

| Type | How it's recognized |
|---|---|
| `EMAIL` | Standard email shape (`name@domain.tld`). |
| `PHONE_IN` | Indian mobile numbers: optional `+91`/`91`/`0` prefix, then a digit 6-9 followed by 9 more digits (spaces/dashes allowed). |
| `CARD` | 13-19 digits that also pass the **Luhn checksum** - the same math card networks use to catch typos. A same-length number that fails Luhn (an order ID, a tracking number) is correctly left alone. |
| `AADHAAR` | Exactly 12 digits, doesn't start with 0 or 1 (UIDAI never issues those), and passes the **Verhoeff checksum**. |
| `PAN` | Five letters, four digits, one letter - e.g. `ABCDE1234F`. |
| `SECRET` | Known API key prefixes (`sk-`, `gsk_`, `AKIA`...) or something written like `api_key=...`/`token: ...`/`password: ...`. |

If two detectors both match the same text (a 16-digit card number can
contain a span that also looks like a 10-digit phone number), the more
specific type wins: `CARD > AADHAAR > PAN > SECRET > EMAIL > PHONE_IN`.

## Settings (per API key) - what the provider gets vs. what you see

Three settings live on each `ApiKey`, set from the dashboard's API Keys
page (no `.env` variables involved - unlike semantic caching, there's no
global on/off switch, it's entirely per key):

| `piiMode` | Does detection run? | What the provider receives | What happens to the request |
|---|---|---|---|
| `"off"` | No | The real prompt, untouched | Forwarded normally, exactly like before this feature existed |
| `"mask"` (default) | Yes | The **masked** prompt only | Forwarded, then the answer is masked too before caching/logging |
| `"block"` | Yes | **Nothing** - never sent anywhere | Rejected immediately with `422`, before any cache or provider call |

| `restoreInResponse` | What YOU see in the response |
|---|---|
| `true` (default) | Your real values, swapped back in just for you |
| `false` | The raw placeholders (`[EMAIL_1]`, etc.) - useful if whatever's reading the response shouldn't see real PII either |

`piiTypes` picks which of the six types to look for (default: all six).

## Where the real values live vs. where only masked text goes

| Only ever in memory, for one request | Only the MASKED version is ever written here |
|---|---|
| The prompt/answer text as you typed it | Redis (both the exact-match cache and the semantic cache) |
| The placeholder → real value mapping | MongoDB's `RequestLog.prompt` / `.response` |
| The restored response sent back to you | - |

Nothing above the "memory only" line is ever saved to disk. If a caller's
own session built the mapping from their own prompt, a *different*
caller who happens to hit the same cached (masked) entry never gets
someone else's real values back - only their own.

## Streaming

A placeholder can land split across two chunks of a streamed answer (e.g.
`"...[EMA"` then `"IL_1]..."`). The gateway buffers from the last
unfinished `[` until the closing `]` shows up, so you never see a broken
half-placeholder flash by. One limitation: live streaming can only
restore placeholders that were already part of the prompt - if the model
invents brand-new sensitive-looking text mid-answer (not echoed from the
prompt), that only gets caught once the full answer is scanned right
after the stream ends (which is also when it's cached/logged correctly) -
but the live stream itself won't redact it, since re-scanning the whole
answer after every single chunk isn't practical.

## How to test this yourself

### In the Playground (manual)

**1. Mask mode, restore ON (the default) - prove it round-trips correctly**
- API Keys → create a key, leave PII mode as "Mask" and "Restore in response" checked.
- Playground → use that key, send: `My email is jane@example.com, please confirm it.`
- Expect: the banner says "1 sensitive value redacted (EMAIL)", the "Sent to provider" box shows `[EMAIL_1]`, and the answer shown to you has your real email back.

**2. Restore OFF - the "list the words in square brackets" proof test**
- API Keys → edit that key → uncheck "Restore real values in the response".
- Playground → send: `My email is jane@example.com. Repeat my message back to me exactly, including anything in square brackets.`
- Expect: the answer literally contains `[EMAIL_1]`, not your real email. This is the proof that matters: the model itself only ever saw the placeholder and is just echoing it back - the gateway is choosing not to translate it back for you this time, which is exactly what `restoreInResponse: false` means.

**3. Block mode**
- API Keys → edit the key → set PII mode to "Block".
- Playground → send the same prompt.
- Expect: `422`, a red "Blocked" banner naming the type found (`EMAIL`), and nothing else in the response - no provider call, no cache write.

**4. A number that LOOKS like PII but isn't**
- Switch the key back to "Mask" (or use any key).
- Playground → send: `My order number is 1234 5678 9012 3458` (16 digits, shaped like a card number, but fails the Luhn checksum on purpose).
- Expect: a completely normal response, no PII banner at all - this is deliberately NOT a valid card number, so nothing should be flagged.

### Automated

```bash
npm test          # includes tests/pii.unit.test.js + tests/pii.route.test.js
npm run eval-pii   # precision/recall per type, across 40 hand-written cases
```

`tests/pii.unit.test.js` covers the checksums, each detector, the overlap
priority rule, and masking/restoring - no network or database needed.
`tests/pii.route.test.js` runs the real `/v1/chat` pipeline against real
Mongo + Redis with the LLM providers mocked out: mask mode, block mode,
confirming the cache/log never contain a real value, a provider failure
still only logging the masked prompt, and the streaming split-placeholder
case.

## Latest eval results

```bash
npm run eval-pii
```

Runs `scripts/piiEvalSet.json` (40 hand-written cases: real-looking fake
PII for all six types, plus tricky non-PII - numbers that fail Luhn or
Verhoeff on purpose, dates, prices, a phone-shaped number with the wrong
leading digit) and reports precision/recall/F1 **per type**.

**Latest run: 100% precision and 100% recall on all 6 types, 0 misses.**
Unlike the semantic cache's eval (which has to tune a similarity
threshold), there's nothing to tune here - detection is deterministic
regex + checksum math. This eval mainly exists as a regression guard: if
a future change to a regex or checksum breaks one of the tricky cases,
this is what catches it.

## Limitations

- **No names or addresses yet.** Only the six structured types above are
  detected. A person's name, a home address, or a date of birth written
  in prose isn't caught at all - regex and checksums can't recognize
  free-text PII like that. A future version could add a trained
  NER (named-entity recognition) model for this instead - e.g.
  [Microsoft Presidio](https://microsoft.github.io/presidio/) - rather
  than trying to regex-match something that doesn't have a fixed shape.
- **Indian phone numbers only** (`PHONE_IN`) - no international formats yet.
- **Live streaming only restores already-known placeholders** - see
  "Streaming" above.
- **Block mode only looks at the `prompt` field**, not any other part of
  the request body.
