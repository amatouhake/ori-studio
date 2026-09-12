import type { OristudioCpDocumentSnapshot } from '../../../engine/oristudioCpTypes';
import { AutomationError } from '../../../automation/contracts';
import { prepareOristudioCpReplacement } from '../oristudioCpRuntime';
import { emptyOristudioCpSelection } from '../../../lib/creasePatternViewport';
import { markCpLineageEdited } from '../../../lib/oristudioCpLineage';
import { staleFoldArtifactResourceState } from '../foldArtifactResource';
import { releaseFoldedFigureHandles, retainFoldedFigureHandles } from '../../../cp-workspace/folded/foldedFigureHandles';
import { MAX_SNAPSHOT_HISTORY } from '../snapshotHistory';
import { workspaceOperationsIdle } from '../operationFence';
import { createDesignTab } from '../designTabs';
import { adoptDesign } from '../../../engines/designHandles';
import type { WorkspaceSliceCreator, WorkspaceState } from '../types';

/** Immutable references, private to the application; never a wire/store patch. */
export interface CpExperimentBase {
  document: WorkspaceState['oristudioCpDocument'];
  revision: number;
  annotations: WorkspaceState['oristudioCpAnnotations'];
  figures: WorkspaceState['oristudioCpFoldedFigures'];
  simulations: WorkspaceState['oristudioCpInlineSimulations'];
  past: WorkspaceState['oristudioCpHistoryPast'];
  future: WorkspaceState['oristudioCpHistoryFuture'];
  extensions: WorkspaceState['oristudioCpDocumentExtensions'];
  pins: WorkspaceState['oristudioCpPinnedVertices'];
}
export function captureCpExperimentBase(s: WorkspaceState): CpExperimentBase {
  return { document: s.oristudioCpDocument, revision: s.oristudioCpRevision, annotations: s.oristudioCpAnnotations,
    figures: s.oristudioCpFoldedFigures, simulations: s.oristudioCpInlineSimulations,
    past: s.oristudioCpHistoryPast, future: s.oristudioCpHistoryFuture, extensions: s.oristudioCpDocumentExtensions, pins: s.oristudioCpPinnedVertices };
}
export function matchesCpExperimentBase(s: WorkspaceState, base: CpExperimentBase): boolean {
  const now = captureCpExperimentBase(s);
  return (Object.keys(base) as (keyof CpExperimentBase)[]).every(key => now[key] === base[key]);
}
export interface AutomationSlice {
  commitCpExperiment: (document: OristudioCpDocumentSnapshot, base: CpExperimentBase, label: string, allowed?: () => boolean) => Promise<number>;
  publishDesignExperiment: (kind: 'treemaker' | 'box-pleat', text: string, title: string) => string;
}

export const createAutomationSlice: WorkspaceSliceCreator<AutomationSlice> = (set, get) => ({
  commitCpExperiment: async (document, base, label, allowed = () => true) => {
    const assertBase = () => {
      if (!allowed()) throw new AutomationError('disconnected', 'MCP access was disabled');
      if (!workspaceOperationsIdle()) throw new AutomationError('workspace_busy', 'Wait for the current application action to finish, then retry');
      if (!matchesCpExperimentBase(get(), base)) throw new AutomationError('conflict', 'The live Edit document changed. Export this experiment or begin a new one from the live document; no user work was replaced.');
    };
    assertBase();
    const prepared = await prepareOristudioCpReplacement(document);
    try {
      assertBase();
      const s = get();
      const past = [...s.oristudioCpHistoryPast];
      if (s.oristudioCpDocument) {
        retainFoldedFigureHandles(s.oristudioCpFoldedFigures);
        past.push({ document: s.oristudioCpDocument.document, selection: s.oristudioCpSelection,
          annotations: s.oristudioCpAnnotations, foldedFigures: s.oristudioCpFoldedFigures,
          activeFoldedFigureId: s.oristudioCpActiveFoldedFigureId, inlineSimulations: s.oristudioCpInlineSimulations,
          label, timestamp: new Date().toISOString() });
      }
      const removed = past.splice(0, Math.max(0, past.length - MAX_SNAPSHOT_HISTORY));
      for (const entry of [...removed, ...s.oristudioCpHistoryFuture]) releaseFoldedFigureHandles(entry.foldedFigures ?? []);
      prepared.install();
      const revision = s.oristudioCpRevision + 1;
      set({ oristudioCpDocument: prepared.state, oristudioCpRevision: revision,
        oristudioCpOperationDescriptors: prepared.state.operationDescriptors, oristudioCpLineage: markCpLineageEdited(s.oristudioCpLineage),
        oristudioCpSelection: emptyOristudioCpSelection(), oristudioCpActiveDiagnosticId: null,
        oristudioCpCamvResult: null, oristudioCpError: null, error: null,
        oristudioCpHistoryPast: past, oristudioCpHistoryFuture: [],
        ...staleFoldArtifactResourceState(s.foldArtifactRevision),
        dirty: true, projectEstablished: true, status: 'crease_pattern_ready', projectMessage: label });
      get().scheduleOristudioCamvRefresh();
      return revision;
    } finally { await prepared.discard(); }
  },
  publishDesignExperiment: (kind, text, title) => {
    const tab = createDesignTab(get().designTabs, { kind, title, pendingHydration: true });
    adoptDesign(tab.id, text);
    set({ designTabs: [...get().designTabs, tab], activeDesignId: tab.id, dirty: true, projectEstablished: true });
    // Publication is synchronous; hydration can follow without blocking its
    // receipt. The registry already owns editable serialized state for save.
    void get().hydrateDesignTab(tab.id);
    return tab.id;
  },
});
