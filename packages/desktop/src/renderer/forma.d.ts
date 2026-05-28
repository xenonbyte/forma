interface FormaProduct {
  id: string;
  name: string;
  description: string;
  platform?: string;
  default_language?: string;
}

interface FormaArtifact {
  id: string;
  kind: string;
  title: string;
  preview_url?: string;
  updated_at: string;
}

interface FormaRequirement {
  id: string;
  title: string;
  status: string;
  ui_affected: boolean;
}

interface FormaDesktopAPI {
  listProducts(): Promise<{ products: FormaProduct[] }>;
  getProduct(id: string): Promise<FormaProduct>;
  listArtifacts(productId: string): Promise<{ artifacts: FormaArtifact[] }>;
  getArtifact(
    productId: string,
    artifactId: string
  ): Promise<{ manifest: { id: string; kind: string; title: string }; preview_url?: string }>;
  listRequirements(productId: string): Promise<{ requirements: FormaRequirement[] }>;
  getRequirement(productId: string, requirementId: string): Promise<FormaRequirement>;
  formaServerStatus(): Promise<boolean>;
}

declare global {
  interface Window {
    forma?: FormaDesktopAPI;
  }
}

export {};
