export interface SnapshotBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SnapshotViewport {
  width: number;
  height: number;
  scale: number;
}

export interface SnapshotBackground {
  color: string;
}

export type SnapshotOutputFormat = 'png' | 'webp';

export interface SnapshotAssetDescriptor {
  id: string;
  src: string;
  kind: 'image' | 'svg' | 'background-image';
  status: 'ready' | 'placeholder';
}

export interface SnapshotFontDescriptor {
  family: string;
  status: 'ready' | 'fallback';
}

export interface DesignSnapshotImageDescriptor {
  path: string;
  format: SnapshotOutputFormat;
  width: number;
  height: number;
  pixelRatio: number;
  revision: string;
}

export interface DesignSnapshotTileDescriptor {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  pixelRatio: number;
  path: string;
  format: SnapshotOutputFormat;
  revision: string;
}

export interface DesignSnapshotManifest {
  schemaVersion: '1.0';
  revision: string;
  hash: string;
  viewport: SnapshotViewport;
  background: SnapshotBackground;
  contentBounds: SnapshotBounds;
  fullImage: DesignSnapshotImageDescriptor;
  tiles: DesignSnapshotTileDescriptor[];
  fonts: SnapshotFontDescriptor[];
  assets: SnapshotAssetDescriptor[];
}
