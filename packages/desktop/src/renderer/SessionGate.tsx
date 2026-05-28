import { useState, useEffect, useCallback } from 'react';
import { RETRY_INTERVAL_MS, MAX_RETRY_ATTEMPTS } from './session.js';

interface SessionGateProps {
  children: React.ReactNode;
  // Injectable for testing
  checkStatus?: () => Promise<boolean>;
  retryIntervalMs?: number;
  maxRetries?: number;
}

function defaultCheckStatus(): Promise<boolean> {
  if (typeof window !== 'undefined' && window.forma?.formaServerStatus) {
    return window.forma.formaServerStatus().then(
      (v) => v === true,
      () => false
    );
  }
  return Promise.resolve(false);
}

export function SessionGate({
  children,
  checkStatus = defaultCheckStatus,
  retryIntervalMs = RETRY_INTERVAL_MS,
  maxRetries = MAX_RETRY_ATTEMPTS,
}: SessionGateProps) {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [attempts, setAttempts] = useState(0);

  const tryConnect = useCallback(async () => {
    const ok = await checkStatus();
    if (ok) {
      setConnected(true);
    } else {
      setAttempts((prev) => prev + 1);
      setConnected(false);
    }
  }, [checkStatus]);

  useEffect(() => {
    tryConnect();
  }, [tryConnect]);

  useEffect(() => {
    if (connected === true) return;
    if (attempts === 0) return;
    if (attempts > maxRetries) return;

    const id = setTimeout(() => {
      tryConnect();
    }, retryIntervalMs);

    return () => clearTimeout(id);
  }, [connected, attempts, maxRetries, retryIntervalMs, tryConnect]);

  if (connected === true) {
    return <>{children}</>;
  }

  return (
    <div data-testid="placeholder">
      <p>Connecting to Forma server…</p>
      <p>Make sure `forma serve` is running.</p>
    </div>
  );
}

