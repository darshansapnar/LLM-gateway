import { useCallback, useEffect, useRef, useState } from "react";
import { resolveStepPath } from "./paths.js";
import { NODE_ORDER, CONNECTIONS } from "./nodes.js";

// Packet/path colors by step "state" - the only place that maps the
// engine's abstract states to actual theme colors (CSS variables, so they
// follow the light/dark toggle automatically).
export const PACKET_COLOR = {
  neutral: "var(--color-accent)",
  success: "var(--color-good)",
  error: "var(--color-bad)",
  retry: "var(--color-warn)",
};

export const DEFAULT_METRICS = {
  status: "—",
  provider: "—",
  model: "—",
  latencyMs: null,
  ttftMs: null,
  inputTokens: null,
  outputTokens: null,
  totalTokens: null,
  costUsd: null,
  tokensSaved: null,
  cacheType: "—",
  similarity: null,
  verifierResult: "—",
  judgeUsed: false,
  judgeLatencyMs: null,
  judgeCostUsd: null,
  fallbackUsed: false,
  circuitState: "CLOSED",
  streamedText: "",
};

function freshNodeStates() {
  const states = {};
  for (const id of NODE_ORDER) states[id] = { status: "idle", detail: null, circuitState: undefined, activeKey: 0 };
  return states;
}

function freshPathStates() {
  const states = {};
  for (const c of CONNECTIONS) states[c.id] = { done: false, color: null };
  return states;
}

// Respects the OS/browser "reduce motion" preference - the engine still
// runs the exact same step list and timing, it just snaps travel progress
// straight to 1 instead of animating it (see the `tick` loop below), which
// turns the packet's smooth glide into simple step-by-step node
// highlighting.
function usePrefersReducedMotion() {
  const query = "(prefers-reduced-motion: reduce)";
  const [reduced, setReduced] = useState(() => (typeof window !== "undefined" ? window.matchMedia(query).matches : false));
  useEffect(() => {
    const mql = window.matchMedia(query);
    const handler = (e) => setReduced(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);
  return reduced;
}

let timelineSeq = 0;

// The simulation engine: a tiny state machine that walks `scenario.steps`
// one at a time. It knows nothing about Groq, caches, or the gateway - it
// only understands the three step shapes documented in scenarios.js. A
// single requestAnimationFrame loop acts as a pausable, speed-aware clock
// for every step type; only "travel" steps use the per-frame progress for
// anything visual (moving the packet) - "process"/"wait" steps just wait.
export function useFlowSimulation(scenario) {
  const reducedMotion = usePrefersReducedMotion();

  const [status, setStatus] = useState("idle"); // idle | playing | paused | done
  const [speed, setSpeed] = useState(1);
  const [currentStepIndex, setCurrentStepIndex] = useState(-1);
  const [nodeStates, setNodeStates] = useState(freshNodeStates);
  const [subStepStates, setSubStepStates] = useState({});
  const [activeParent, setActiveParent] = useState(null);
  const [pathStates, setPathStates] = useState(freshPathStates);
  const [extraPaths, setExtraPaths] = useState([]);
  const [activeTravel, setActiveTravel] = useState(null);
  const [waitInfo, setWaitInfo] = useState(null);
  const [timeline, setTimeline] = useState([]);
  const [metrics, setMetrics] = useState(DEFAULT_METRICS);

  const speedRef = useRef(speed);
  speedRef.current = speed;
  const statusRef = useRef(status);
  statusRef.current = status;
  const reducedMotionRef = useRef(reducedMotion);
  reducedMotionRef.current = reducedMotion;

  const stepIndexRef = useRef(0);
  const elapsedRef = useRef(0);
  const lastFrameRef = useRef(0);
  const rafRef = useRef(null);
  const runTokenRef = useRef(0);

  const pushTimeline = useCallback((message) => {
    if (!message) return;
    timelineSeq += 1;
    setTimeline((prev) => [...prev, { id: timelineSeq, message, at: Date.now() }]);
  }, []);

  const mergeMetrics = useCallback((update) => {
    if (!update) return;
    setMetrics((prev) => {
      const next = { ...prev };
      for (const [key, value] of Object.entries(update)) {
        if (key === "streamAppend") {
          next.streamedText = (prev.streamedText || "") + value;
        } else {
          next[key] = value;
        }
      }
      return next;
    });
  }, []);

  const hardReset = useCallback(() => {
    runTokenRef.current += 1;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    stepIndexRef.current = 0;
    elapsedRef.current = 0;
    lastFrameRef.current = 0;
    setCurrentStepIndex(-1);
    setNodeStates(freshNodeStates());
    setSubStepStates({});
    setActiveParent(null);
    setPathStates(freshPathStates());
    setExtraPaths([]);
    setActiveTravel(null);
    setWaitInfo(null);
    setTimeline([]);
    setMetrics(DEFAULT_METRICS);
  }, []);

  const reset = useCallback(() => {
    hardReset();
    setStatus("idle");
  }, [hardReset]);

  // Starting a fresh scenario selection resets everything (but doesn't
  // auto-play - the animation never starts on its own).
  useEffect(() => {
    reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenario]);

  useEffect(
    () => () => {
      runTokenRef.current += 1;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    },
    []
  );

  const beginStep = useCallback((step) => {
    if (step.type === "travel") {
      const { d, reverse } = resolveStepPath(step);
      setActiveTravel({ d, reverse, progress: 0, color: PACKET_COLOR[step.state] || PACKET_COLOR.neutral, packetType: step.packet });
    } else if (step.type === "process") {
      if (step.parentNode) {
        setActiveParent(step.parentNode);
        setSubStepStates((prev) => ({ ...prev, [step.node]: { status: "active", detail: null } }));
      } else {
        setNodeStates((prev) => ({
          ...prev,
          [step.node]: { ...prev[step.node], status: "active", activeKey: (prev[step.node]?.activeKey ?? 0) + 1 },
        }));
      }
    } else if (step.type === "wait") {
      setWaitInfo({ node: step.node, label: step.label, remainingMs: step.duration });
    }
  }, []);

  const finalizeStep = useCallback(
    (step) => {
      if (step.type === "travel") {
        setActiveTravel(null);
        if (step.via === "return" || step.state === "retry" || step.state === "error") {
          const { d } = resolveStepPath(step);
          const color = PACKET_COLOR[step.state] || PACKET_COLOR.neutral;
          setExtraPaths((prev) => [...prev, { id: `trail-${prev.length}-${step.from}-${step.to}`, d, color }]);
        } else {
          const { connectionId } = resolveStepPath(step);
          if (connectionId) {
            const color = PACKET_COLOR[step.state] || PACKET_COLOR.neutral;
            setPathStates((prev) => ({ ...prev, [connectionId]: { done: true, color } }));
          }
        }
      } else if (step.type === "process") {
        if (step.parentNode) {
          setSubStepStates((prev) => ({ ...prev, [step.node]: { status: step.status, detail: step.detail } }));
        } else {
          setNodeStates((prev) => ({
            ...prev,
            [step.node]: {
              ...prev[step.node],
              status: step.status,
              detail: step.detail ?? prev[step.node]?.detail,
              circuitState: step.detail?.circuitState ?? prev[step.node]?.circuitState,
            },
          }));
        }
      } else if (step.type === "wait") {
        setWaitInfo(null);
      }

      if (step.timeline) pushTimeline(step.timeline);
      if (step.metrics) mergeMetrics(step.metrics);
    },
    [pushTimeline, mergeMetrics]
  );

  const loop = useCallback(
    (myToken) => {
      const steps = scenario.steps;

      const tick = (now) => {
        if (runTokenRef.current !== myToken) return;

        if (statusRef.current !== "playing") {
          rafRef.current = requestAnimationFrame(tick);
          return;
        }

        const delta = lastFrameRef.current ? now - lastFrameRef.current : 0;
        lastFrameRef.current = now;
        elapsedRef.current += delta * speedRef.current;

        const step = steps[stepIndexRef.current];
        if (!step) {
          setStatus("done");
          return;
        }

        const duration = Math.max(1, step.duration ?? 400);
        const rawProgress = Math.min(1, elapsedRef.current / duration);

        if (step.type === "travel") {
          const visualProgress = reducedMotionRef.current ? 1 : rawProgress;
          setActiveTravel((prev) => (prev ? { ...prev, progress: visualProgress } : prev));
        } else if (step.type === "wait") {
          setWaitInfo((prev) => (prev ? { ...prev, remainingMs: Math.max(0, duration - elapsedRef.current) } : prev));
        }

        if (rawProgress >= 1) {
          finalizeStep(step);
          stepIndexRef.current += 1;
          elapsedRef.current = 0;
          const nextStep = steps[stepIndexRef.current];
          setCurrentStepIndex(stepIndexRef.current);
          if (!nextStep) {
            setStatus("done");
            return;
          }
          beginStep(nextStep);
        }

        rafRef.current = requestAnimationFrame(tick);
      };

      rafRef.current = requestAnimationFrame(tick);
    },
    [scenario, finalizeStep, beginStep]
  );

  const run = useCallback(() => {
    if (status === "paused") {
      lastFrameRef.current = 0;
      setStatus("playing");
      return;
    }

    // idle or done: (re)start from the top.
    hardReset();
    runTokenRef.current += 1;
    const myToken = runTokenRef.current;
    setCurrentStepIndex(0);
    setStatus("playing");
    const first = scenario.steps[0];
    if (first) beginStep(first);
    loop(myToken);
  }, [status, scenario, hardReset, beginStep, loop]);

  const pause = useCallback(() => {
    setStatus((prev) => (prev === "playing" ? "paused" : prev));
  }, []);

  return {
    status,
    speed,
    setSpeed,
    reducedMotion,
    currentStep: scenario.steps[currentStepIndex] ?? null,
    nodeStates,
    subStepStates,
    activeParent,
    pathStates,
    extraPaths,
    activeTravel,
    waitInfo,
    timeline,
    metrics,
    run,
    pause,
    reset,
  };
}
