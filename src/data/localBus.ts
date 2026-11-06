// Tiny change notifier for the LOCAL (localStorage) backend, so it can offer the same subscribe() API as
// Firestore. Not used when Firebase is configured.
const listeners = new Set<() => void>();

export const localBus = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
  notify(): void {
    listeners.forEach((listener) => listener());
  },
};
