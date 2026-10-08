import { Archive, Brain, Database, FileCheck2, Gauge, KeyRound, Laptop, Sparkles, Waypoints, Zap } from "lucide-react";
import { CONNECTIONS, NODES, VIEWBOX_HEIGHT, VIEWBOX_WIDTH } from "../../lib/request-flow/nodes.js";
import FlowConnection from "./FlowConnection.jsx";
import FlowNode from "./FlowNode.jsx";
import ProviderNode from "./ProviderNode.jsx";
import CacheNode from "./CacheNode.jsx";
import RequestPacket from "./RequestPacket.jsx";

const ICONS = {
  client: Laptop,
  auth: KeyRound,
  ratelimit: Gauge,
  exactcache: Database,
  semanticcache: Brain,
  router: Waypoints,
  groq: Zap,
  gemini: Sparkles,
  response: FileCheck2,
  cachelog: Archive,
};

// The diagram itself: a fixed-size SVG (paths + the traveling packet)
// layered under a set of absolutely-positioned HTML node cards at the
// exact same coordinates. Fixed pixel size (not percentage-scaled) so node
// cards never get crowded/overlapping on a narrow viewport - the page
// wraps this in a horizontal-scroll container instead (see RequestFlow.jsx).
export default function FlowCanvas({
  nodeStates,
  subStepStates,
  pathStates,
  extraPaths,
  activeTravel,
  currentStep,
  speed,
  waitInfo,
  streamedText,
}) {
  function ringDurationFor(nodeId) {
    if (!currentStep || currentStep.type !== "process" || currentStep.parentNode) return undefined;
    if (currentStep.node !== nodeId) return undefined;
    return Math.max(1, (currentStep.duration ?? 450) / speed);
  }

  function renderNode(id) {
    const node = NODES[id];
    const state = { ...nodeStates[id], durationMs: ringDurationFor(id) ?? 450 };
    const common = { x: node.x, y: node.y, icon: ICONS[id], label: node.label, caption: node.caption, state };

    if (id === "groq" || id === "gemini") return <ProviderNode key={id} {...common} />;
    if (id === "exactcache") return <CacheNode key={id} {...common} />;
    if (id === "semanticcache") return <CacheNode key={id} {...common} subStepStates={subStepStates} />;
    return <FlowNode key={id} {...common} />;
  }

  return (
    <div className="relative" style={{ width: VIEWBOX_WIDTH, height: VIEWBOX_HEIGHT }}>
      <svg
        viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
        width={VIEWBOX_WIDTH}
        height={VIEWBOX_HEIGHT}
        className="absolute inset-0"
      >
        {CONNECTIONS.map((c) => (
          <FlowConnection key={c.id} d={c.d} state={pathStates[c.id]} isActive={activeTravel?.d === c.d} />
        ))}
        {extraPaths.map((p) => (
          <path key={p.id} d={p.d} fill="none" stroke={p.color} strokeWidth={2.5} strokeLinecap="round" opacity={0.75} />
        ))}
        <RequestPacket activeTravel={activeTravel} />
      </svg>

      {Object.keys(NODES).map(renderNode)}

      {waitInfo && (
        <div
          className="absolute flex items-center gap-1.5 rounded-full border border-warn-bg bg-surface px-2 py-1 text-[10px] font-medium text-warn-ink shadow-sm"
          style={{ left: NODES[waitInfo.node]?.x ?? 0, top: (NODES[waitInfo.node]?.y ?? 0) - 56, transform: "translate(-50%, -50%)" }}
        >
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-warn" />
          {waitInfo.label}
          {typeof waitInfo.remainingMs === "number" && <span className="font-mono">{Math.ceil(waitInfo.remainingMs)}ms</span>}
        </div>
      )}

      {streamedText && (
        <div
          className="absolute w-56 rounded-lg border border-line bg-surface p-2 text-[10.5px] leading-snug text-ink-soft shadow-md"
          style={{ left: NODES.client.x, top: NODES.client.y + 60, transform: "translateX(-50%)" }}
        >
          <div className="mb-1 text-[9px] font-semibold uppercase tracking-wide text-ink-muted">Streaming response</div>
          {streamedText}
          <span className="animate-pulse text-accent">▍</span>
        </div>
      )}
    </div>
  );
}
