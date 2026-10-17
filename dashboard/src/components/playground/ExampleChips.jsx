// Quick-fill chips that replace the body editor with a ready-made prompt,
// chosen to make a live demo of each cache behavior fast: a fresh prompt,
// the exact same prompt again (exact hit), a reworded version of it
// (semantic hit, if the key has semantic caching on), and an antonym of it
// (semantic candidate found but rejected by the guard).
const EXAMPLES = [
  { label: "Normal prompt", prompt: "How do I turn on dark mode in VS Code?" },
  { label: "PII mask demo", prompt: "My phone number is 9876543210 and email is alex@example.com." },
  { label: "Cache hit demo", repeatLast: true },
  { label: "Semantic cache demo", prompt: "Can you tell me how to enable dark theme in Visual Studio Code?" },
  { label: "Guard rejection demo", prompt: "How do I turn off dark mode in VS Code?" },
  { label: "Fallback demo", prompt: "Explain how an API gateway provides high availability through provider fallback." },
];

export default function ExampleChips({ lastPrompt, onPick }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {EXAMPLES.map((example) => {
        const disabled = example.repeatLast && !lastPrompt;
        return (
          <button
            key={example.label}
            type="button"
            disabled={disabled}
            onClick={() => onPick(example.repeatLast ? lastPrompt : example.prompt)}
            title={example.repeatLast ? lastPrompt || "Send a request first" : example.prompt}
            className="rounded-full border border-line bg-surface px-2.5 py-1 text-xs font-medium text-ink-soft hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {example.label}
          </button>
        );
      })}
    </div>
  );
}
