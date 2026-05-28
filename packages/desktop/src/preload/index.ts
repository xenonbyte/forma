// SPEC-IF-DESKTOP-001: ONLY these readonly methods are exposed via contextBridge.
// Static imports are safe here: electron-vite builds preload as a separate CJS bundle
// where electron modules are always available. Dynamic imports were removed because
// contextBridge.exposeInMainWorld must be called synchronously before the renderer loads.

import { contextBridge, ipcRenderer } from 'electron';

// SPEC-IF-DESKTOP-001: exactly these seven readonly methods, nothing else.
export const readonlyApi = {
  listProducts: () => ipcRenderer.invoke('forma:listProducts'),
  getProduct: (id: string) => ipcRenderer.invoke('forma:getProduct', id),
  listArtifacts: (productId: string) => ipcRenderer.invoke('forma:listArtifacts', productId),
  getArtifact: (productId: string, artifactId: string) =>
    ipcRenderer.invoke('forma:getArtifact', productId, artifactId),
  listRequirements: (productId: string) => ipcRenderer.invoke('forma:listRequirements', productId),
  getRequirement: (productId: string, requirementId: string) =>
    ipcRenderer.invoke('forma:getRequirement', productId, requirementId),
  formaServerStatus: () => ipcRenderer.invoke('forma:serverStatus'),
};

export type FormaDesktopAPI = typeof readonlyApi;

contextBridge.exposeInMainWorld('forma', readonlyApi);
