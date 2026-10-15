// The one thing the app's own page may ask of the desktop shell: the LinkedIn
// panel (main.mjs, "Sixgree's own browser"). Show it, hide it, say where it
// starts (the bottom of the page's top bar), and hear when it changes. Nothing
// else of Electron reaches the page, and main.mjs answers only the app's own
// address. LinkedIn's page in the panel never has this: it runs without a preload.
//
// CommonJS, as a sandboxed preload must be.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sixgreeDesktop', {
  linkedinPanel: {
    /** { available, visible, linkedin } now. */
    state: () => ipcRenderer.invoke('linkedin-panel:state'),
    show: () => ipcRenderer.send('linkedin-panel:show'),
    hide: () => ipcRenderer.send('linkedin-panel:hide'),
    /** Where the panel starts, in the page's CSS pixels from the top of the window. */
    setTop: (px) => ipcRenderer.send('linkedin-panel:top', Number(px)),
    /** Called with the state whenever it changes; returns a function that stops it. */
    onState: (fn) => {
      const listener = (_event, state) => fn(state);
      ipcRenderer.on('linkedin-panel:state', listener);
      return () => ipcRenderer.removeListener('linkedin-panel:state', listener);
    },
  },
});
