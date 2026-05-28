import { useState, useEffect } from 'react';

interface Artifact {
  id: string;
  kind: string;
  title: string;
  preview_url?: string;
  updated_at: string;
}

interface Requirement {
  id: string;
  title: string;
  status: string;
  ui_affected: boolean;
}

interface ProductViewProps {
  forma: {
    listArtifacts(productId: string): Promise<{ artifacts: Artifact[] }>;
    listRequirements(productId: string): Promise<{ requirements: Requirement[] }>;
  };
  productId: string;
  onBack: () => void;
  onSelectArtifact?: (artifactId: string) => void;
}

type Tab = 'artifacts' | 'requirements';

export function ProductView({ forma, productId, onBack, onSelectArtifact }: ProductViewProps) {
  const [activeTab, setActiveTab] = useState<Tab>('artifacts');
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [loadingArtifacts, setLoadingArtifacts] = useState(true);
  const [loadingRequirements, setLoadingRequirements] = useState(false);
  const [requirementsFetched, setRequirementsFetched] = useState(false);

  useEffect(() => {
    forma
      .listArtifacts(productId)
      .then(({ artifacts: a }) => {
        setArtifacts(a);
        setLoadingArtifacts(false);
      })
      .catch(() => setLoadingArtifacts(false));
  }, [forma, productId]);

  const handleTabChange = (tab: Tab) => {
    setActiveTab(tab);
    if (tab === 'requirements' && !requirementsFetched) {
      setLoadingRequirements(true);
      forma
        .listRequirements(productId)
        .then(({ requirements: r }) => {
          setRequirements(r);
          setLoadingRequirements(false);
          setRequirementsFetched(true);
        })
        .catch(() => setLoadingRequirements(false));
    }
  };

  return (
    <div>
      <button onClick={onBack}>← Back</button>

      <div style={{ display: 'flex', gap: '8px', margin: '16px 0' }}>
        <button
          data-tab="artifacts"
          onClick={() => handleTabChange('artifacts')}
          style={{ fontWeight: activeTab === 'artifacts' ? 'bold' : 'normal' }}
        >
          Artifacts
        </button>
        <button
          data-tab="requirements"
          onClick={() => handleTabChange('requirements')}
          style={{ fontWeight: activeTab === 'requirements' ? 'bold' : 'normal' }}
        >
          Requirements
        </button>
      </div>

      {activeTab === 'artifacts' && (
        <div>
          {loadingArtifacts ? (
            <div>Loading artifacts…</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '16px' }}>
              {artifacts.map((a) => (
                <div
                  key={a.id}
                  data-artifact-id={a.id}
                  onClick={() => onSelectArtifact?.(a.id)}
                  style={{ border: '1px solid #ccc', borderRadius: '8px', overflow: 'hidden', cursor: onSelectArtifact ? 'pointer' : 'default' }}
                >
                  {a.preview_url && (
                    <img
                      src={a.preview_url}
                      alt={a.title}
                      style={{ width: '100%', display: 'block' }}
                    />
                  )}
                  <div style={{ padding: '8px' }}>{a.title}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'requirements' && (
        <div>
          {loadingRequirements ? (
            <div>Loading requirements…</div>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0 }}>
              {requirements.map((r) => (
                <li
                  key={r.id}
                  style={{ padding: '8px', borderBottom: '1px solid #eee', display: 'flex', alignItems: 'center', gap: '8px' }}
                >
                  {r.title}
                  {r.ui_affected && (
                    <span style={{ fontSize: '12px', background: '#e0e7ff', color: '#3730a3', padding: '2px 6px', borderRadius: '4px' }}>
                      UI
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
