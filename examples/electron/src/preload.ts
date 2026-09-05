import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import { IPC, type DemoBridge, type DemoState, type RendererAction } from "./shared.js";

const api: DemoBridge = {
  ready() {
    ipcRenderer.send(IPC.ready);
  },
  onState(listener) {
    const handler = (_event: IpcRendererEvent, next: DemoState) => {
      listener(next);
    };
    ipcRenderer.on(IPC.state, handler);
    return () => {
      ipcRenderer.removeListener(IPC.state, handler);
    };
  },
  reportActivity(targetId) {
    return ipcRenderer.invoke(IPC.reportActivity, targetId) as Promise<void>;
  },
  openWindow() {
    return ipcRenderer.invoke(IPC.openWindow) as Promise<void>;
  },
  setDemoIdle(idle) {
    return ipcRenderer.invoke(IPC.setDemoIdle, idle) as Promise<void>;
  },
  setExpiredAction(action: RendererAction) {
    return ipcRenderer.invoke(IPC.setExpiredAction, action) as Promise<void>;
  },
};

contextBridge.exposeInMainWorld("demo", api);
