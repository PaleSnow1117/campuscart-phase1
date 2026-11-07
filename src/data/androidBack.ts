import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";

// Android hardware / gesture Back button. Capacitor's own Android code has no back handling: without a handler the
// system simply closes the app. The handler lives in the official @capacitor/app NATIVE plugin. This file talks to
// that plugin through @capacitor/core only, so the web build never needs the plugin and nothing here runs on the
// web or on iOS. If the native plugin has not been installed yet, the app keeps its old behaviour (a console note).

type AppPlugin = {
  addListener(event: "backButton", listener: (event: { canGoBack: boolean }) => void): Promise<PluginListenerHandle>;
  exitApp(): Promise<void>;
};

let plugin: AppPlugin | null = null;
const appPlugin = (): AppPlugin => (plugin ??= registerPlugin<AppPlugin>("App"));

/**
 * Installs ONE Back-button listener and returns a function that removes it. `onBack` decides what happens:
 * "handled" means the app navigated itself; "exit" closes the app (only used on the main screen).
 */
export function installAndroidBackButton(onBack: () => "handled" | "exit"): () => void {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== "android") return () => undefined;
  if (!Capacitor.isPluginAvailable("App")) {
    console.warn("[CampusCart] Android Back button not handled: install the @capacitor/app plugin and run `npx cap sync android`.");
    return () => undefined;
  }
  const app = appPlugin();
  let removed = false;
  let handle: PluginListenerHandle | null = null;
  app
    .addListener("backButton", () => {
      if (onBack() === "exit") void app.exitApp().catch(() => undefined);
    })
    .then((added) => {
      // The effect may have been cleaned up before the plugin answered; never leave a listener behind.
      if (removed) void added.remove().catch(() => undefined);
      else handle = added;
    })
    .catch(() => undefined);
  return () => {
    removed = true;
    if (handle) {
      void handle.remove().catch(() => undefined);
      handle = null;
    }
  };
}
