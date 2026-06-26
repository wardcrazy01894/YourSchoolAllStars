// Auto-update: never let a tab left open run a stale build. No backend — Vite
// emits /version.json containing the build hash (see vite.config.ts), and
// import.meta.env.VITE_BUILD_HASH is the hash baked into THIS bundle. When the
// tab regains focus we compare; if a newer build is deployed, we reload.

const LOADED_HASH = import.meta.env.VITE_BUILD_HASH as string | undefined

/** True when both hashes are known, real, and differ → a new build is live. */
export function isStale(
  loadedHash: string | undefined,
  deployedHash: string | undefined,
): boolean {
  if (!loadedHash || !deployedHash) return false
  if (loadedHash === 'dev' || deployedHash === 'dev') return false // local dev
  return loadedHash !== deployedHash
}

/** Fetch the deployed build hash from /version.json (cache-busted). */
export async function fetchDeployedHash(
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  try {
    const res = await fetchImpl(`${import.meta.env.BASE_URL}version.json`, {
      cache: 'no-store',
    })
    if (!res.ok) return null
    const data = (await res.json()) as { hash?: string }
    return data.hash ?? null
  } catch {
    return null
  }
}

/**
 * Reload when a newer deploy is detected on focus/visibility. Throttled so we
 * don't refetch on every micro-focus. Returns a cleanup fn. Pure parts (isStale,
 * fetchDeployedHash) are unit-tested; this DOM wiring is verified manually.
 */
export function setupAutoUpdate(opts?: {
  onUpdate?: () => void
  minIntervalMs?: number
  loadedHash?: string
}): () => void {
  const onUpdate = opts?.onUpdate ?? (() => window.location.reload())
  const minInterval = opts?.minIntervalMs ?? 60_000
  const loaded = opts?.loadedHash ?? LOADED_HASH
  let last = 0
  let stopped = false

  async function check() {
    if (stopped) return
    const now = Date.now()
    if (now - last < minInterval) return
    last = now
    const deployed = await fetchDeployedHash()
    if (isStale(loaded, deployed ?? undefined)) onUpdate()
  }

  const onVis = () => {
    if (document.visibilityState === 'visible') check()
  }
  document.addEventListener('visibilitychange', onVis)
  window.addEventListener('focus', check)
  check() // an initial check shortly after load
  return () => {
    stopped = true
    document.removeEventListener('visibilitychange', onVis)
    window.removeEventListener('focus', check)
  }
}
