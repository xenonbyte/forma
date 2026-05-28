import { useState, useEffect, useCallback } from 'react';

interface ArtifactDetailProps {
  forma: {
    getArtifact(
      productId: string,
      artifactId: string
    ): Promise<{ manifest: { id: string; kind: string; title: string }; preview_url?: string }>;
  };
  productId: string;
  artifactId: string;
  onClose: () => void;
}

interface ArtifactData {
  manifest: { id: string; kind: string; title: string };
  preview_url?: string;
}

type LoadState = 'loading' | 'ready' | 'error';

export function ArtifactDetail({ forma, productId, artifactId, onClose }: ArtifactDetailProps) {
  const [state, setState] = useState<LoadState>('loading');
  const [artifact, setArtifact] = useState<ArtifactData | null>(null);

  useEffect(() => {
    forma
      .getArtifact(productId, artifactId)
      .then((data) => {
        setArtifact(data);
        setState('ready');
      })
      .catch(() => setState('error'));
  }, [forma, productId, artifactId]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    },
    [onClose]
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const preview2x = artifact?.preview_url?.replace('1x', '2x');

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.8)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
    >
      <button
        data-close
        onClick={onClose}
        style={{ position: 'absolute', top: '16px', right: '16px', padding: '8px 16px' }}
      >
        Close
      </button>

      {state === 'loading' && <div style={{ color: '#fff' }}>Loading…</div>}
      {state === 'error' && <div style={{ color: '#fff' }}>Failed to load artifact</div>}
      {state === 'ready' && artifact && (
        <div style={{ maxWidth: '90vw', maxHeight: '90vh', overflow: 'auto' }}>
          {preview2x ? (
            <img
              src={preview2x}
              alt={artifact.manifest.title}
              style={{ display: 'block', maxWidth: '100%' }}
            />
          ) : (
            <div style={{ color: '#fff' }}>No preview available</div>
          )}
        </div>
      )}
    </div>
  );
}
