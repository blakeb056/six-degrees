// The one thing the app's own page may ask of the desktop shell: the LinkedIn
// panel (main.mjs, "Sixgree's own browser"). Show it, hide it, open it for
// browsing, say where it starts (the bottom of the page's top bar) and what
// it keeps clear, say when something is open over it, and hear when it changes. Nothing
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
    /** Shown for your own browsing (the LinkedIn browser plugin's button), on LinkedIn's feed if nothing is open. */
    browse: () => ipcRenderer.send('linkedin-panel:browse'),
    /** Shown on one LinkedIn section ('feed', 'messaging', 'notifications', 'jobs'): the LinkedIn tab's notch buttons. */
    section: (key) => ipcRenderer.send('linkedin-panel:section', String(key)),
    hide: () => ipcRenderer.send('linkedin-panel:hide'),
    /** Where the panel starts, in the page's CSS pixels from the top of the window. */
    setTop: (px) => ipcRenderer.send('linkedin-panel:top', Number(px)),
    /** Where it starts, and what the page keeps clear to its right and under it, in CSS pixels. */
    place: ({ top, right = 0, bottom = 0 } = {}) => ipcRenderer.send('linkedin-panel:place', { top: Number(top), right: Number(right), bottom: Number(bottom) }),
    /** Something the page opened is over the panel (true), or nothing is (false). */
    cover: (on) => ipcRenderer.send('linkedin-panel:cover', on === true),
    /** Called with { n, src } when the panel's still picture is to be drawn (src a data: URL) or taken away (src null). */
    onStill: (fn) => {
      const listener = (_event, still) => fn(still);
      ipcRenderer.on('linkedin-panel:still', listener);
      return () => ipcRenderer.removeListener('linkedin-panel:still', listener);
    },
    /** The still picture n is drawn: the panel may go. */
    stillDrawn: (n) => ipcRenderer.send('linkedin-panel:still-drawn', Number(n)),
    /** Called with the state whenever it changes; returns a function that stops it. */
    onState: (fn) => {
      const listener = (_event, state) => fn(state);
      ipcRenderer.on('linkedin-panel:state', listener);
      return () => ipcRenderer.removeListener('linkedin-panel:state', listener);
    },
  },
});
