import { useState } from "react";
import PageHeader from "../components/layout/PageHeader.jsx";
import ScenarioSelector from "../components/request-flow/ScenarioSelector.jsx";
import FlowCanvas from "../components/request-flow/FlowCanvas.jsx";
import RequestTimeline from "../components/request-flow/RequestTimeline.jsx";
import FlowMetrics from "../components/request-flow/FlowMetrics.jsx";
import { SCENARIOS, SCENARIOS_BY_ID } from "../lib/request-flow/scenarios.js";
import { useFlowSimulation } from "../lib/request-flow/useFlowSimulation.js";

// Reads a `?scenario=<id>` query param set by the time this page mounts
// (e.g. Playground's "View Full Request Flow" link) and preselects that
// scenario - without auto-playing it, same as picking it from the dropdown.
// Falls back to the first scenario if the param is missing or unknown.
function initialScenarioId() {
  const fromQuery = new URLSearchParams(window.location.search).get("scenario");
  return fromQuery && SCENARIOS_BY_ID[fromQuery] ? fromQuery : SCENARIOS[0].id;
}

// An interactive page that visually explains the full lifecycle of a
// request through the gateway - entirely simulated (mock data), no calls
// to the real backend. See lib/request-flow/ for the scenario data and
// the simulation engine, and components/request-flow/ for the diagram.
export default function RequestFlow({ onOpenMobileNav }) {
  const [scenarioId, setScenarioId] = useState(initialScenarioId);
  const scenario = SCENARIOS_BY_ID[scenarioId];

  const sim = useFlowSimulation(scenario);

  return (
    <section>
      <PageHeader
        title="Request Flow"
        subtitle="Visualize how requests move through the LLM Gateway."
        onOpenMobileNav={onOpenMobileNav}
      />

      <div className="flex flex-col gap-4">
        <ScenarioSelector
          scenarioId={scenarioId}
          onChangeScenario={(id) => {
            setScenarioId(id);
          }}
          status={sim.status}
          onRun={sim.run}
          onPause={sim.pause}
          onReset={sim.reset}
          speed={sim.speed}
          onChangeSpeed={sim.setSpeed}
        />

        <p className="-mt-1 text-xs text-ink-muted">{scenario.description}</p>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="overflow-x-auto rounded-xl border border-line bg-surface p-4">
            <FlowCanvas
              nodeStates={sim.nodeStates}
              subStepStates={sim.subStepStates}
              pathStates={sim.pathStates}
              extraPaths={sim.extraPaths}
              activeTravel={sim.activeTravel}
              currentStep={sim.currentStep}
              speed={sim.speed}
              waitInfo={sim.waitInfo}
              streamedText={sim.metrics.streamedText}
            />
          </div>

          <div className="flex flex-col gap-4">
            <RequestTimeline events={sim.timeline} />
            <FlowMetrics metrics={sim.metrics} />
          </div>
        </div>
      </div>
    </section>
  );
}
