import type { UseAnalysisBundleImportResult } from './AnalysisBundleImport';
import styles from '../styles/app.module.css';

const EXAMPLE_BUNDLE_URL = `${import.meta.env.BASE_URL}example/all-clips-session.neurotrack.json`;

interface LoadExampleAnalysisProps {
  bundleImport: UseAnalysisBundleImportResult;
  disabled?: boolean;
}

export function LoadExampleAnalysis({ bundleImport, disabled = false }: LoadExampleAnalysisProps) {
  const { importBusy, loadExampleBundle } = bundleImport;

  return (
    <button
      type="button"
      className={styles.buttonPrimary}
      data-testid="load-example-btn"
      disabled={disabled || importBusy}
      onClick={() => void loadExampleBundle(EXAMPLE_BUNDLE_URL)}
    >
      Load example analysis
    </button>
  );
}
