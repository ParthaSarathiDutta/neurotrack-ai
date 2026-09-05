import styles from '../styles/app.module.css';
import type { TrialRecord } from '../domain/types';
import { getTrialReviewStatus, reviewStatusLabel } from '../domain/migration';
import { useSessionStore } from '../store/sessionStore';

function statusBadge(status: TrialRecord['ingestStatus']) {
  switch (status) {
    case 'ready':
      return <span className={styles.badgeReady}>Ready</span>;
    case 'needs_reselect':
      return <span className={styles.badgeNeedsReselect}>Reselect video</span>;
    case 'error':
      return <span className={styles.badgeError}>Error</span>;
    case 'indexing':
      return <span className={styles.badgeIndexing}>Processing</span>;
    default:
      return <span className={styles.badge}>Pending</span>;
  }
}

export function TrialList() {
  const trials = useSessionStore((s) => s.trials);
  const selectedTrialId = useSessionStore((s) => s.selectedTrialId);
  const selectTrial = useSessionStore((s) => s.selectTrial);

  if (trials.length === 0) {
    return (
      <section className={styles.panel} aria-labelledby="trials-heading">
        <h2 id="trials-heading">Trials</h2>
        <p>No trials loaded yet.</p>
      </section>
    );
  }

  return (
    <section className={styles.panel} aria-labelledby="trials-heading">
      <h2 id="trials-heading" data-testid="trials-heading">
        Trials ({trials.length})
      </h2>
      <ul className={styles.trialList} role="list">
        {trials.map((trial) => {
          const isSelected = trial.id === selectedTrialId;
          return (
            <li key={trial.id} className={styles.trialItem}>
              <button
                type="button"
                className={isSelected ? styles.trialButtonSelected : styles.trialButton}
                aria-pressed={isSelected}
                aria-label={`${trial.label}, ${trial.fileName}${isSelected ? ', selected' : ''}`}
                onClick={() => selectTrial(trial.id)}
              >
                <span className={styles.trialButtonHeader}>
                  <strong>{trial.label}</strong>
                  {isSelected && (
                    <span className={styles.selectedMarker} aria-hidden="true">
                      Selected
                    </span>
                  )}
                </span>
                <span className={styles.mono}>{trial.fileName}</span>
                {statusBadge(trial.ingestStatus)}
                {trial.ingestStatus === 'ready' && (
                  <span className={styles.reviewBadge} data-testid={`review-badge-${trial.label}`}>
                    {reviewStatusLabel(getTrialReviewStatus(trial))}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
