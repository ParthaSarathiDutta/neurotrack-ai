import { TrialDetailPanel } from './TrialDetailPanel';
import { ResultsExportPanel } from './ResultsExportPanel';
import { TrialVisualizationsPanel } from './TrialVisualizationsPanel';
import type { TrialRecord } from '../domain/types';

interface ImportedAnalysisViewProps {
  trial: TrialRecord;
  allTrials: TrialRecord[];
  onSeekToFrame?: (frameIndex: number) => void;
}

/** Results and export for bundle-imported trials when video bytes are not cached locally. */
export function ImportedAnalysisView({ trial, allTrials, onSeekToFrame }: ImportedAnalysisViewProps) {
  return (
    <>
      <TrialDetailPanel trial={trial} />
      <TrialVisualizationsPanel trial={trial} onSeekToFrame={onSeekToFrame} />
      <ResultsExportPanel trial={trial} allTrials={allTrials} showImportControls={false} />
    </>
  );
}
