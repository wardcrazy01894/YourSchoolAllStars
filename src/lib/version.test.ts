import { describe, it, expect, vi } from 'vitest'
import { isStale, fetchDeployedHash } from './version'

describe('isStale', () => {
  it('is true only when both hashes are real and differ', () => {
    expect(isStale('abc123', 'def456')).toBe(true)
    expect(isStale('abc123', 'abc123')).toBe(false)
  })
  it('is false when either hash is missing', () => {
    expect(isStale(undefined, 'def456')).toBe(false)
    expect(isStale('abc123', undefined)).toBe(false)
    expect(isStale(undefined, undefined)).toBe(false)
  })
  it('ignores the local-dev sentinel hash', () => {
    expect(isStale('dev', 'abc123')).toBe(false)
    expect(isStale('abc123', 'dev')).toBe(false)
  })
})

describe('fetchDeployedHash', () => {
  it('returns the hash from a 200 /version.json', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ hash: 'deadbeef' }),
    } as Response)
    expect(await fetchDeployedHash(fetchMock)).toBe('deadbeef')
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('version.json'),
      expect.objectContaining({ cache: 'no-store' }),
    )
  })
  it('returns null on a non-OK response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false } as Response)
    expect(await fetchDeployedHash(fetchMock)).toBe(null)
  })
  it('returns null when the fetch throws (offline)', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('offline'))
    expect(await fetchDeployedHash(fetchMock)).toBe(null)
  })
})
