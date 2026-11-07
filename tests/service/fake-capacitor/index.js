// A tiny stand-in for @capacitor/core: just enough to test how our Android back-button code installs and removes
// its listener. Tests steer it through globalThis.__cap.
const C = (globalThis.__cap ??= { native: true, platform: "android", available: true, listeners: [], removed: 0, exits: 0, addDelayMs: 0 });
export const Capacitor = {
  isNativePlatform: () => C.native,
  getPlatform: () => C.platform,
  isPluginAvailable: () => C.available,
};
export const registerPlugin = () => ({
  async addListener(event, listener) {
    if (C.addDelayMs) await new Promise((r) => setTimeout(r, C.addDelayMs));
    const entry = { event, listener, active: true }; C.listeners.push(entry);
    return { remove: async () => { entry.active = false; C.removed += 1; } };
  },
  async exitApp() { C.exits += 1; },
});
