'use client';

// A Connections.csv import, start to end, for both of its doors: the guided
// setup (Blake, 2026-10-12: "In the onboarding we can let them drag and drop
// or find the CSV file needed") and the Import page, for every import after
// the first. Each draws it its own way; this is what they share.
//
//   pick       nothing chosen yet (or Choose another file)
//   reading    the file is read and parsed here, then staged on the server
//   preview    what importing would do (lib/csv.js importLines), nothing changed
//   importing  Import was pressed
//   done       it's in your network
//
// The file is read in this window (lib/csv.js parseConnectionsCsv), and only
// what the map needs goes to this computer's server. An error is said where
// it happened, and the step stays where it was, so Import can be pressed again.

import { useCallback, useRef, useState } from 'react';
import {
  parseConnectionsCsv, ConnectionsCsvError, previewCsvImport, applyCsvImport, dropCsvPreview,
} from '../../lib/csv';
import { rememberSetup } from '../../lib/onboarding';

const READ_FAILED = 'Could not read that file. Make sure it is Connections.csv from your connections export.';

function readText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(String(e.target.result || ''));
    reader.onerror = () => reject(new Error(READ_FAILED));
    reader.readAsText(file);
  });
}

export default function useCsvImport() {
  const [step, setStep] = useState('pick');
  const [error, setError] = useState('');
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  // A second file dropped while the first is still being read waits its turn.
  const busy = useRef(false);

  const choose = useCallback(async (file) => {
    if (!file || busy.current) return;
    busy.current = true;
    setError('');
    setStep('reading');
    try {
      const text = await readText(file);
      const { connections, skipped } = parseConnectionsCsv(text);
      const answer = await previewCsvImport(connections);
      if (!answer.ok) {
        setError(answer.error);
        setStep('pick');
        return;
      }
      setPreview({ ...answer, fileName: file.name || 'Connections.csv', skipped });
      setStep('preview');
    } catch (err) {
      setError(err instanceof ConnectionsCsvError ? err.message : READ_FAILED);
      setStep('pick');
    } finally {
      busy.current = false;
    }
  }, []);

  const confirm = useCallback(async () => {
    if (!preview || busy.current) return;
    busy.current = true;
    setError('');
    setStep('importing');
    const done = await applyCsvImport(preview.stage);
    busy.current = false;
    if (!done.ok) {
      setError(done.error);
      setStep('preview');
      return;
    }
    // Imported: the setup's "Your galaxy is ready" belongs to a first scan,
    // so it isn't shown again for this one (lib/onboarding.js opensSetup).
    rememberSetup({ finished: true });
    setResult(done);
    setStep('done');
  }, [preview]);

  const again = useCallback(() => {
    if (busy.current) return;
    if (preview?.stage && step === 'preview') dropCsvPreview(preview.stage);
    setPreview(null);
    setResult(null);
    setError('');
    setStep('pick');
  }, [preview, step]);

  return { step, error, preview, result, choose, confirm, again };
}
