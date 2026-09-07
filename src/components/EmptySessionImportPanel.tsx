import { LoadExampleAnalysis } from './LoadExampleAnalysis';
import { AnalysisBundleImport, useAnalysisBundleImport } from './AnalysisBundleImport';
import styles from '../styles/app.module.css';

export function EmptySessionImportPanel() {
  const bundleImport = useAnalysisBundleImport();

  return (
    <section className={styles.panel} aria-labelledby="detail-placeholder">
      <h2 id="detail-placeholder">Get started</h2>
      <p>
        Load MP4 trial videos to run a new analysis, restore a saved bundle, or open the committed
        three-trial example (no video required for reports and charts).
      </p>
      <div className={styles.actions}>
        <LoadExampleAnalysis bundleImport={bundleImport} />
        <AnalysisBundleImport
          bundleImport={bundleImport}
          buttonTestId="import-bundle-empty-btn"
          inputTestId="import-bundle-empty-input"
        />
      </div>
    </section>
  );
}
