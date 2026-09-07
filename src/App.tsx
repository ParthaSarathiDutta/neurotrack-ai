import { useEffect } from 'react';
import styles from './styles/app.module.css';
import { VideoIngestPanel } from './components/VideoIngestPanel';
import { TrialList } from './components/TrialList';
import { TrialDetailPanel } from './components/TrialDetailPanel';
import { ReviewView } from './components/ReviewView';
import { ImportedAnalysisView } from './components/ImportedAnalysisView';
import { AnalysisBundleImport } from './components/AnalysisBundleImport';
import { useSessionStore } from './store/sessionStore';
import { canShowVideoReview, hasStoredAnalysis } from './domain/trialAnalysis';

export default function App() {
  const hydrated = useSessionStore((s) => s.hydrated);
  const hydrate = useSessionStore((s) => s.hydrate);
  const statusMessage = useSessionStore((s) => s.statusMessage);
  const persistPending = useSessionStore((s) => s.persistPending);
  const trials = useSessionStore((s) => s.trials);
  const selectedTrialId = useSessionStore((s) => s.selectedTrialId);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  const selected = trials.find((t) => t.id === selectedTrialId) ?? null;
  const showReview = selected != null && canShowVideoReview(selected);
  const showImportedAnalysis = selected != null && hasStoredAnalysis(selected) && !showReview;

  if (!hydrated) {
    return (
      <main className={styles.app}>
        <p role="status">Loading session…</p>
      </main>
    );
  }

  return (
    <main className={styles.app}>
      <header className={styles.header}>
        <h1>NeuroTrack AI</h1>
        <p className={styles.subtitle}>Barnes maze video analysis</p>
      </header>

      <div className={styles.layout}>
        <div>
          <VideoIngestPanel />
          <TrialList />
        </div>
        <div>
          {showReview && selected ? (
            <ReviewView trial={selected} allTrials={trials} />
          ) : showImportedAnalysis && selected ? (
            <ImportedAnalysisView trial={selected} allTrials={trials} />
          ) : selected ? (
            <TrialDetailPanel trial={selected} />
          ) : (
            <EmptySessionPanel />
          )}
        </div>
      </div>

      <p className={styles.status} role="status" aria-live="polite" data-testid="status-message">
        {statusMessage}
      </p>
      <span
        hidden
        aria-hidden="true"
        data-testid="session-persisted"
        data-ready={persistPending ? 'false' : 'true'}
      />

      <p className={styles.footerNote}>
        All video processing runs locally in your browser. No data leaves this device.
      </p>
    </main>
  );
}

function EmptySessionPanel() {
  return (
    <section className={styles.panel} aria-labelledby="detail-placeholder">
      <h2 id="detail-placeholder">Get started</h2>
      <p>Load MP4 trial videos to run a new analysis, or restore a saved analysis bundle.</p>
      <div className={styles.actions}>
        <AnalysisBundleImport buttonTestId="import-bundle-empty-btn" inputTestId="import-bundle-empty-input" />
      </div>
    </section>
  );
}
