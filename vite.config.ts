import { execSync } from 'child_process'
import { defineConfig, configDefaults } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Served from a github.io PROJECT page (https://wardcrazy01894.github.io/
// YourSchoolAllStars/), so the base path must match the repo name or every
// asset URL 404s. If a custom domain is added later, change this back to '/'.
// (`vitest/config` re-exports vite's defineConfig and adds the typed `test` key.)

function getBuildHash(): string {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim()
  } catch {
    return 'dev'
  }
}

const BUILD_HASH = getBuildHash()

export default defineConfig({
  base: '/YourSchoolAllStars/',
  plugins: [
    react(),
    {
      // Emit /version.json so the client can detect a new deploy on tab focus.
      name: 'version-json',
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'version.json',
          source: JSON.stringify({ hash: BUILD_HASH }),
        })
      },
    },
  ],
  define: {
    'import.meta.env.VITE_BUILD_HASH': JSON.stringify(BUILD_HASH),
  },
  test: {
    environment: 'jsdom',
    exclude: [...configDefaults.exclude, '**/.claude/worktrees/**'],
  },
})
