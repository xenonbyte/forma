// SPEC-IF-DESKTOP-001: ONLY these readonly methods are exposed via contextBridge.
// ipcRenderer is loaded dynamically so that this module can be imported in
// non-Electron test environments without crashing.

async function invokeIpc(channel: string, ...args: unknown[]): Promise<unknown> {
  const { ipcRenderer } = await import('electron');
  return ipcRenderer.invoke(channel, ...args);
}

// SPEC-IF-DESKTOP-001: exactly these seven readonly methods, nothing else.
export const readonlyApi = {
  listProducts: () => invokeIpc('forma:listProducts'),
  getProduct: (id: string) => invokeIpc('forma:getProduct', id),
  listArtifacts: (productId: string) => invokeIpc('forma:listArtifacts', productId),
  getArtifact: (productId: string, artifactId: string) =>
    invokeIpc('forma:getArtifact', productId, artifactId),
  listRequirements: (productId: string) => invokeIpc('forma:listRequirements', productId),
  getRequirement: (productId: string, requirementId: string) =>
    invokeIpc('forma:getRequirement', productId, requirementId),
  formaServerStatus: () => invokeIpc('forma:serverStatus'),
};

export type FormaDesktopAPI = typeof readonlyApi;

// Only wire up contextBridge in the real Electron preload environment.
if (process.env.NODE_ENV !== 'test') {
  const { contextBridge } = await import('electron');
  contextBridge.exposeInMainWorld('forma', readonlyApi);
}
