// Vitest global setup.
//
// jsdom (as wired here) doesn't provide a working `localStorage`: Node 22 ships
// an experimental global `localStorage` that shadows jsdom's and is inert unless
// the process is started with `--localstorage-file`. Rather than couple the test
// run to that flag, install a small in-memory Storage shim so the daily-result /
// streak persistence (`src/lib/progress.ts`) is testable and deterministic.

class MemoryStorage implements Storage {
  private store = new Map<string, string>()

  get length(): number {
    return this.store.size
  }
  clear(): void {
    this.store.clear()
  }
  getItem(key: string): string | null {
    return this.store.has(key) ? (this.store.get(key) as string) : null
  }
  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null
  }
  removeItem(key: string): void {
    this.store.delete(key)
  }
  setItem(key: string, value: string): void {
    this.store.set(key, String(value))
  }
}

Object.defineProperty(globalThis, 'localStorage', {
  value: new MemoryStorage(),
  configurable: true,
  writable: true,
})
