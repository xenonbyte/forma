import { useState, useEffect, useCallback } from 'react';

interface ConnectionGateProps {
  children: React.ReactNode;
  /** Injectable for testing; defaults to the preload IPC status check. */
  checkStatus?: () => Promise<boolean>;
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

/**
 * Read-only connection gate. On mount (and on retry) calls the preload
 * `formaServerStatus()` IPC. While disconnected, renders a full-screen
 * Chinese overlay with a retry button; once connected, renders children
 * (the AppShell).
 */
export function ConnectionGate({ children, checkStatus = defaultCheckStatus }: ConnectionGateProps) {
  const [connected, setConnected] = useState<boolean | null>(null);

  const tryConnect = useCallback(async () => {
    const ok = await checkStatus();
    setConnected(ok);
  }, [checkStatus]);

  useEffect(() => {
    void tryConnect();
  }, [tryConnect]);

  if (connected === true) {
    return <>{children}</>;
  }

  if (connected === null) {
    return (
      <div className="gate" data-gate="checking">
        <p className="gate__body">连接中…</p>
      </div>
    );
  }

  return (
    <div className="gate" data-gate="disconnected">
      <h1 className="gate__title">未连接到 Forma 服务</h1>
      <p className="gate__body">请确认本地 `forma serve` 已启动后重试。</p>
      <button className="gate__retry" data-gate-retry onClick={() => void tryConnect()}>
        重试连接
      </button>
    </div>
  );
}
