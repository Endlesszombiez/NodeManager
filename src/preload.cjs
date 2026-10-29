const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('nodeManager', Object.freeze({
  invoke: async (action, payload) => {
    const result = await ipcRenderer.invoke('manager:invoke', action, payload);
    if (!result.ok) throw new Error(result.error);
    return result.value;
  },
  onEvent: callback => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('manager:event', listener);
    return () => ipcRenderer.removeListener('manager:event', listener);
  }
}));
