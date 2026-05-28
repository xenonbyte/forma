// Stub for Electron APIs in Vitest (node environment — no real Electron).
import { vi } from 'vitest';

export const ipcRenderer = {
  invoke: vi.fn().mockResolvedValue(undefined),
};

export const contextBridge = {
  exposeInMainWorld: vi.fn(),
};
