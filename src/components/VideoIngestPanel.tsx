import { useCallback, useId, useRef, useState } from 'react';
import styles from '../styles/app.module.css';
import { useSessionStore } from '../store/sessionStore';

function collectVideoFiles(list: FileList | File[]): File[] {
  return [...list].filter((f) => f.type === 'video/mp4' || f.name.toLowerCase().endsWith('.mp4'));
}

export function VideoIngestPanel() {
  const addFiles = useSessionStore((s) => s.addFiles);
  const ingestBusy = useSessionStore((s) => s.ingestBusy);
  const [dragActive, setDragActive] = useState(false);
  const fileInputId = useId();
  const folderInputId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(
    async (files: File[]) => {
      const videos = collectVideoFiles(files);
      if (videos.length === 0) return;
      await addFiles(videos);
    },
    [addFiles],
  );

  return (
    <section className={styles.panel} aria-labelledby="ingest-heading">
      <h2 id="ingest-heading">Load videos</h2>
      <p>Drag and drop MP4 trial videos, choose files, or select a folder.</p>

      <div
        className={`${styles.dropZone} ${dragActive ? styles.dropZoneActive : ''}`}
        onDragEnter={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={() => setDragActive(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragActive(false);
          void handleFiles([...e.dataTransfer.files]);
        }}
      >
        <p>Drop Barnes maze videos here</p>
        <div className={styles.actions}>
          <label htmlFor={fileInputId} className={`${styles.button} ${styles.buttonPrimary}`}>
            Choose files
          </label>
          <label htmlFor={folderInputId} className={styles.button}>
            Choose folder
          </label>
        </div>
      </div>

      <input
        ref={fileRef}
        id={fileInputId}
        className={styles.hiddenInput}
        type="file"
        accept="video/mp4,video/*"
        multiple
        disabled={ingestBusy}
        onChange={(e) => {
          if (e.target.files) void handleFiles([...e.target.files]);
          e.target.value = '';
        }}
      />
      <input
        ref={folderRef}
        id={folderInputId}
        className={styles.hiddenInput}
        type="file"
        accept="video/mp4,video/*"
        multiple
        disabled={ingestBusy}
        {...({ webkitdirectory: '', directory: '' } as React.InputHTMLAttributes<HTMLInputElement>)}
        onChange={(e) => {
          if (e.target.files) void handleFiles([...e.target.files]);
          e.target.value = '';
        }}
      />
    </section>
  );
}
