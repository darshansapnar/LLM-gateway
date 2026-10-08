import { ChevronDown, Pause, Play, RotateCcw } from "lucide-react";
import { SCENARIOS } from "../../lib/request-flow/scenarios.js";

const SPEEDS = [0.5, 1, 2];

// The top toolbar: pick a scenario, then Run / Pause / Replay, plus a
// speed control. The animation never starts on its own - only Run starts
// or resumes it.
export default function ScenarioSelector({ scenarioId, onChangeScenario, status, onRun, onPause, onReset, speed, onChangeSpeed }) {
  const isPlaying = status === "playing";

  return (
    <div className="flex flex-wrap items-center gap-2.5 rounded-xl border border-line bg-surface p-3">
      <div className="relative">
        <select
          value={scenarioId}
          onChange={(e) => onChangeScenario(e.target.value)}
          className="appearance-none rounded-lg border border-line bg-surface py-2 pl-3 pr-8 text-sm font-medium text-ink outline-none hover:bg-surface-2 focus:border-accent"
        >
          {SCENARIOS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
        <ChevronDown size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-muted" />
      </div>

      <div className="h-6 w-px bg-line" />

      <button
        type="button"
        onClick={onRun}
        disabled={isPlaying}
        className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Play size={14} fill="currentColor" />
        Run
      </button>

      <button
        type="button"
        onClick={onPause}
        disabled={!isPlaying}
        className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-2 text-sm font-medium text-ink-soft hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Pause size={14} />
        Pause
      </button>

      <button
        type="button"
        onClick={onReset}
        className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-2 text-sm font-medium text-ink-soft hover:bg-surface-2"
      >
        <RotateCcw size={14} />
        Replay
      </button>

      <div className="ml-auto flex items-center gap-0.5 rounded-lg border border-line bg-surface-2 p-0.5">
        {SPEEDS.map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => onChangeSpeed(value)}
            className={
              value === speed
                ? "rounded-md bg-surface px-2.5 py-1.5 text-xs font-semibold text-ink shadow-sm"
                : "rounded-md px-2.5 py-1.5 text-xs font-medium text-ink-muted hover:text-ink-soft"
            }
          >
            {value}x
          </button>
        ))}
      </div>
    </div>
  );
}
