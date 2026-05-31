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
  requirement_id?: string;
  page_id?: string;
  variant?: string;
  current_version?: number;
}

interface FormaRequirementPage {
  page_id: string;
  name: string;
  baseline_page?: string;
  design_status?: string;
}

interface FormaRequirement {
  id: string;
  title: string;
  status: string;
  ui_affected: boolean;
  pages?: FormaRequirementPage[];
}

interface FormaStyleMetadata {
  name: string;
  description: string;
  category?: string;
  upstream?: string;
  design_md_path?: string;
  tokens_css_path?: string;
  components_html_path?: string;
}

interface FormaBrandStyleContent {
  kind: 'brand';
  metadata: FormaStyleMetadata;
  designMd: string;
  tokensCss: string;
  componentsHtml: string;
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
  formaServerBaseUrl(): Promise<string>;
  listStyles(): Promise<FormaStyleMetadata[]>;
  getStyle(name: string): Promise<FormaBrandStyleContent>;
}

declare global {
  interface Window {
    forma?: FormaDesktopAPI;
  }
}

export {};
