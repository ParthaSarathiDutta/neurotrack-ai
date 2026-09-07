import { TrialDetailPanel } from './TrialDetailPanel';
import { ResultsExportPanel } from './ResultsExportPanel';
import type { TrialRecord } from '../domain/types';

interface ImportedAnalysisViewProps {
  trial: TrialRecord;
  allTrials: TrialRecord[];
}

/** Results and export for bundle-imported trials when video bytes are not cached locally. */
export function ImportedAnalysisView({ trial, allTrials }: ImportedAnalysisViewProps) {
  return (
    <>
      <TrialDetailPanel trial={trial} />
      <ResultsExportPanel trial={trial} allTrials={allTrials} showImportControls={false} />
    </>
  );
}
