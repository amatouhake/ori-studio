import type { FoldDocument } from '../engine/types';
import { simulationInputFromFold } from '../lib/creasePatternImport';
import { withSourceFoldTargets } from './sourceFoldTargets';
import { createSimulatorSession } from './simulatorSession';

/** Source-pattern entry point for the isolated MCP worker. Provenance capture,
 * planar topology, orientation and final solver preparation all run there.
 * The owner can terminate this worker even while synchronous preparation runs. */
export function createSourceSimulatorSession() {
  const session = createSimulatorSession();
  return {
    ...session,
    loadSourceFold(source: FoldDocument) {
      const fold = simulationInputFromFold(withSourceFoldTargets(source) as FoldDocument);
      return session.load(fold, { preferGpu: false, prepare: { triangulate: false } });
    },
  };
}
export type SourceSimulatorWorkerApi = ReturnType<typeof createSourceSimulatorSession>;
