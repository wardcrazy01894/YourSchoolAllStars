/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Optional leaderboard + streaks worker URL (worker/leaderboard.mjs). When
   *  unset, the standing line is omitted and streaks stay local-only. */
  readonly VITE_LEADERBOARD_ENDPOINT?: string
  /** Git short hash injected at build time (vite.config.ts). */
  readonly VITE_BUILD_HASH?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
