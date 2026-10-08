import FlowNode from "./FlowNode.jsx";
import VerifierSteps from "./VerifierSteps.jsx";

// Exact Cache / Semantic Cache: a FlowNode that can additionally show the
// semantic-cache verifier sub-stepper (only the Semantic Cache node passes
// `subStepStates`; Exact Cache renders as a plain FlowNode).
export default function CacheNode({ x, y, icon, label, caption, state, subStepStates }) {
  return (
    <FlowNode x={x} y={y} icon={icon} label={label} caption={caption} state={state}>
      {subStepStates && <VerifierSteps subStepStates={subStepStates} />}
    </FlowNode>
  );
}
