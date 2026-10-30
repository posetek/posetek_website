// Development-only synthetic interaction fixture. No Firebase operations.
import { useRef, useState } from "react";
import { JumpReviewEditor, type JumpReviewServices } from "./JumpReviewPanel";
import type { JumpRecoveryInput, JumpRecoveryPreview, JumpReviewContext } from "../lib/jumpRecovery";
import syntheticVideoUrl from "../fixtures/jump-review-synthetic.mp4?url";
import syntheticSource from "../fixtures/jump-review-synthetic.json";

function demoResult(input: JumpRecoveryInput): JumpRecoveryPreview {
  const height = input.method === "manual_marker" ? .24 : .31;
  return { heightMetres: height, displayValue: `~${height * 100} cm`, method: input.method, label: "ESTIMATE", rangeMetres: [height - .02, height + .02], sourceFingerprint: input.sourceFingerprint, fields: { jumpHeight: height }, warnings: ["Synthetic preview calculation. This is not an athlete measurement."] };
}

const initialContext: JumpReviewContext = { source: { ...syntheticSource, path: "synthetic/jump/session1/kick1/demo.mp4", generation: "demo-1", mediaUrl: syntheticVideoUrl, poseAvailable: true }, expectedRevisionId: null, originalHeight: .18, originalHeightIsEstimate: false, rootJumpHeight: .18, jumpRecovery: null, availableMethods: ["manual_marker", "flight_time"], blockers: [], sourceFingerprint: syntheticSource.sourceVideoSha256 };

export default function JumpReviewDemo() {
  const [context, setContext] = useState<JumpReviewContext>(initialContext);
  const [saved, setSaved] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);
  const current = useRef<JumpReviewContext>(initialContext);
  const saves = useRef(new Map<string, { revisionId: string; height: number }>());
  const services: JumpReviewServices = {
    load: async () => current.current!,
    preview: async (_playerId, _repId, input) => demoResult(input),
    save: async (_playerId, _repId, input) => {
      let saved = saves.current.get(input.operationId);
      if (!saved) { saved = { revisionId: `demo-estimate-${saves.current.size + 1}`, height: demoResult(input).heightMetres }; saves.current.set(input.operationId, saved); }
      const jumpRecovery = { isEstimate: true, heightMetres: saved.height };
      current.current = { ...current.current!, expectedRevisionId: saved.revisionId, originalHeight: saved.height, originalHeightIsEstimate: true, rootJumpHeight: null, jumpRecovery };
      return { revisionId: saved.revisionId, folder: "synthetic", rep: { jumpHeight: null, jumpRecovery, resultsValid: false } };
    },
  };
  return <><section className="admin-heading"><div><p className="eyebrow">Development preview</p><h1>Jump recovery review</h1></div></section>
    <p className="admin-banner warn">Synthetic example only. This page uses invented measurements and a generated figure. It never reads or changes athlete records.</p>
    {saved && <p className="admin-banner good" role="status">Demo save verified: {saved}. ESTIMATE only; no cloud record or message was created.</p>}
    <JumpReviewEditor key={generation} playerId="synthetic" repId="synthetic-jump" athleteName="Example player" context={context} services={services}
      onSaved={revision => { setSaved(revision); setContext(current.current); setGeneration(n => n + 1); }} onReload={() => { setContext(current.current); setGeneration(n => n + 1); }} />
  </>;
}
