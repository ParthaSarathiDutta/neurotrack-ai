import { useEffect } from 'react';
import styles from './styles/app.module.css';
import { VideoIngestPanel } from './components/VideoIngestPanel';
import { TrialList } from './components/TrialList';
import { TrialDetailPanel } from './components/TrialDetailPanel';
import { useSessionStore } from './store/sessionStore';

export default function App() {
  const hydrated = useSessionStore((s) => s.hydrated);
  const hydrate = useSessionStore((s) => s.hydrate);
  const statusMessage = useSessionStore((s) => s.statusMessage);
  const trials = useSessionStore((s) => s.trials);
  const selectedTrialId = useSessionStore((s) => s.selectedTrialId);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  const selected = trials.find((t) => t.id === selectedTrialId) ?? null;

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
        <div>{selected ? <TrialDetailPanel trial={selected} /> : <TrialDetailPanelPlaceholder />}</div>
      </div>

      <p className={styles.status} role="status" aria-live="polite" data-testid="status-message">
        {statusMessage}
      </p>

      <p className={styles.footerNote}>
        All video processing runs locally in your browser. No data leaves this device.
      </p>
    </main>
  );
}

function TrialDetailPanelPlaceholder() {
  return (
    <section className={styles.panel} aria-labelledby="detail-placeholder">
      <h2 id="detail-placeholder">Trial details</h2>
      <p>Select a trial to view its summary.</p>
    </section>
  );
}
