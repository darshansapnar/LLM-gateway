// Geometry for the Request Flow diagram: every node's position plus the
// static forward connections between them. Coordinates are in SVG viewBox
// units - the canvas renders at a fixed pixel size (see RequestFlow.jsx)
// and scrolls horizontally on narrow screens rather than squeezing node
// cards (which would overlap once text no longer fits).
//
// Layout is a straight main lane (y = MAIN_Y) from Client to Cache+Logging,
// with Groq/Gemini branching above/below around the Provider Router, and a
// second "return lane" (y = RETURN_Y) below everything that any node can
// drop into to travel straight back to the Client - this is what makes
// cache-hit shortcuts and error responses "skip" the rest of the diagram.
export const VIEWBOX_WIDTH = 1480;
export const VIEWBOX_HEIGHT = 440;
export const MAIN_Y = 210;
export const RETURN_Y = 400;

export const NODES = {
  client: { id: "client", label: "Client / Application", caption: "POST /v1/chat", x: 70, y: MAIN_Y },
  auth: { id: "auth", label: "API Key Auth", caption: "auth.js", x: 250, y: MAIN_Y },
  ratelimit: { id: "ratelimit", label: "Rate Limiter", caption: "Redis", x: 430, y: MAIN_Y },
  exactcache: { id: "exactcache", label: "Exact Cache", caption: "Redis GET", x: 610, y: MAIN_Y },
  semanticcache: { id: "semanticcache", label: "Semantic Cache", caption: "Vector search", x: 790, y: MAIN_Y },
  router: { id: "router", label: "Provider Router", caption: "router.service.js", x: 960, y: MAIN_Y },
  groq: { id: "groq", label: "Groq", caption: "primary", x: 1110, y: 100 },
  gemini: { id: "gemini", label: "Gemini", caption: "fallback", x: 1110, y: 320 },
  response: { id: "response", label: "Response Generated", caption: "", x: 1260, y: MAIN_Y },
  cachelog: { id: "cachelog", label: "Cache + Logging", caption: "observability", x: 1410, y: MAIN_Y },
};

export const NODE_ORDER = [
  "client",
  "auth",
  "ratelimit",
  "exactcache",
  "semanticcache",
  "router",
  "groq",
  "gemini",
  "response",
  "cachelog",
];

// Semantic cache verifier sub-steps - rendered as a small internal stepper
// inside the Semantic Cache node rather than as their own full nodes on the
// main diagram (see VerifierSteps.jsx). The main packet "parks" at
// semanticcache while these advance.
export const VERIFIER_SUBSTEPS = [
  { id: "embed", label: "Generate Embedding" },
  { id: "vectorsearch", label: "Redis Vector Search" },
  { id: "similarity", label: "Similarity Check" },
  { id: "guard", label: "Antonym Guard" },
  { id: "entity", label: "Entity Check" },
  { id: "judge", label: "LLM Judge" },
];

function elbow(points) {
  return points.map(([x, y], i) => `${i === 0 ? "M" : "L"} ${x} ${y}`).join(" ");
}

function straight(a, b) {
  return elbow([
    [a.x, a.y],
    [b.x, b.y],
  ]);
}

// A rounded-looking elbow for branch connections (router <-> groq/gemini):
// out horizontally from `a`, a vertical jog at the midpoint, then in
// horizontally to `b`.
function branch(a, b) {
  const midX = (a.x + b.x) / 2;
  return elbow([
    [a.x, a.y],
    [midX, a.y],
    [midX, b.y],
    [b.x, b.y],
  ]);
}

// The fixed forward topology, drawn permanently (in an "idle" tone) so the
// whole pipeline is visible before anything runs. `id` is always
// `${from}-${to}` - resolvePath() in paths.js looks travel steps up by this
// key (trying the reverse too) so scenario data can just say from/to.
export const CONNECTIONS = [
  { id: "client-auth", from: "client", to: "auth", d: straight(NODES.client, NODES.auth) },
  { id: "auth-ratelimit", from: "auth", to: "ratelimit", d: straight(NODES.auth, NODES.ratelimit) },
  { id: "ratelimit-exactcache", from: "ratelimit", to: "exactcache", d: straight(NODES.ratelimit, NODES.exactcache) },
  { id: "exactcache-semanticcache", from: "exactcache", to: "semanticcache", d: straight(NODES.exactcache, NODES.semanticcache) },
  { id: "semanticcache-router", from: "semanticcache", to: "router", d: straight(NODES.semanticcache, NODES.router) },
  { id: "router-groq", from: "router", to: "groq", d: branch(NODES.router, NODES.groq) },
  { id: "router-gemini", from: "router", to: "gemini", d: branch(NODES.router, NODES.gemini) },
  { id: "groq-response", from: "groq", to: "response", d: branch(NODES.groq, NODES.response) },
  { id: "gemini-response", from: "gemini", to: "response", d: branch(NODES.gemini, NODES.response) },
  { id: "response-cachelog", from: "response", to: "cachelog", d: straight(NODES.response, NODES.cachelog) },
];

export const CONNECTIONS_BY_ID = Object.fromEntries(CONNECTIONS.map((c) => [c.id, c]));

// Any node can drop down to the return lane and travel straight back to
// the Client - this is the "shortcut" path for cache hits and early
// rejections (401/429/guard). Always returns a fresh `d` string (not a
// shared one) since it starts from a different x per node.
export function returnPathFrom(nodeId) {
  const n = NODES[nodeId];
  const client = NODES.client;
  return elbow([
    [n.x, n.y],
    [n.x, RETURN_Y],
    [client.x, RETURN_Y],
    [client.x, client.y],
  ]);
}
