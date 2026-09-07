import { useRef, useState, type RefObject } from 'react';
import { useSessionStore } from '../store/sessionStore';
import type { ImportCollision } from '../domain/export/bundleImport';
import styles from '../styles/app.module.css';

export interface UseAnalysisBundleImportResult {
  fileInputRef: RefObject<HTMLInputElement | null>;
  importBusy: boolean;
  importError: string | null;
  pendingImport: { json: string; collisions: ImportCollision[] } | null;
  openFilePicker: () => void;
  handleImportFile: (file: File) => Promise<void>;
  confirmPendingImport: () => Promise<void>;
  cancelPendingImport: () => void;
}

export function useAnalysisBundleImport(): UseAnalysisBundleImportResult {
  const importAnalysisBundle = useSessionStore((s) => s.importAnalysisBundle);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [pendingImport, setPendingImport] = useState<{ json: string; collisions: ImportCollision[] } | null>(null);
  const [importBusy, setImportBusy] = useState(false);

  const handleImportFile = async (file: File) => {
    setImportError(null);
    setImportBusy(true);
    try {
      const json = await file.text();
      const result = await importAnalysisBundle(json, false);
      if (result.status === 'collision') {
        setPendingImport({ json, collisions: result.collisions });
        return;
      }
      if (result.status === 'error') {
        setImportError(
          result.errors?.map((e) => `${e.path}: ${e.message}`).join('; ') ?? result.message,
        );
        return;
      }
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Import failed.');
    } finally {
      setImportBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const confirmPendingImport = async () => {
    if (!pendingImport) return;
    setImportBusy(true);
    setImportError(null);
    try {
      const result = await importAnalysisBundle(pendingImport.json, true);
      if (result.status === 'error') {
        setImportError(
          result.errors?.map((e) => `${e.path}: ${e.message}`).join('; ') ?? result.message,
        );
        return;
      }
      setPendingImport(null);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Import failed.');
    } finally {
      setImportBusy(false);
    }
  };

  return {
    fileInputRef,
    importBusy,
    importError,
    pendingImport,
    openFilePicker: () => fileInputRef.current?.click(),
    handleImportFile,
    confirmPendingImport,
    cancelPendingImport: () => setPendingImport(null),
  };
}

interface AnalysisBundleImportProps {
  buttonTestId?: string;
  inputTestId?: string;
  errorTestId?: string;
  dialogTestId?: string;
  confirmTestId?: string;
  cancelTestId?: string;
  buttonLabel?: string;
  className?: string;
  disabled?: boolean;
}

export function AnalysisBundleImport({
  buttonTestId = 'import-bundle-btn',
  inputTestId = 'import-bundle-input',
  errorTestId = 'import-bundle-error',
  dialogTestId = 'import-collision-dialog',
  confirmTestId = 'import-collision-confirm-btn',
  cancelTestId = 'import-collision-cancel-btn',
  buttonLabel = 'Load analysis bundle',
  className,
  disabled = false,
}: AnalysisBundleImportProps) {
  const {
    fileInputRef,
    importBusy,
    importError,
    pendingImport,
    openFilePicker,
    handleImportFile,
    confirmPendingImport,
    cancelPendingImport,
  } = useAnalysisBundleImport();

  return (
    <div className={className}>
      <button
        type="button"
        className={styles.button}
        data-testid={buttonTestId}
        disabled={disabled || importBusy}
        onClick={openFilePicker}
      >
        {buttonLabel}
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept=".neurotrack.json,.json,application/json"
        hidden
        data-testid={inputTestId}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleImportFile(file);
        }}
      />

      {importError && (
        <p className={styles.warning} role="alert" data-testid={errorTestId}>
          {importError}
        </p>
      )}

      {pendingImport && (
        <div className={styles.importConfirmBox} data-testid={dialogTestId}>
          <h4>Replace existing trials?</h4>
          <p>
            This bundle conflicts with {pendingImport.collisions.length} existing trial record(s).
            Importing will replace the stored analysis for those trials. Reviewed events and measures
            in the bundle will be preserved exactly — no re-tracking or re-detection.
          </p>
          <ul>
            {pendingImport.collisions.map((c) => (
              <li key={`${c.reason}-${c.existingTrialId}-${c.incomingTrialId}`}>
                {c.reason === 'trial_id' ? 'Same trial ID' : 'Same video fingerprint'}: replace{' '}
                <strong>{c.existingFileName}</strong> ({c.existingTrialId}) with{' '}
                <strong>{c.incomingFileName}</strong>
              </li>
            ))}
          </ul>
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.buttonPrimary}
              data-testid={confirmTestId}
              disabled={importBusy}
              onClick={() => void confirmPendingImport()}
            >
              Replace and import
            </button>
            <button
              type="button"
              className={styles.button}
              data-testid={cancelTestId}
              disabled={importBusy}
              onClick={cancelPendingImport}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
