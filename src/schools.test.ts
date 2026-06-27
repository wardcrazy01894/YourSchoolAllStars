import { describe, it, expect } from 'vitest'
import { SCHOOLS, getSchool, applyTheme, DEFAULT_SCHOOL_ID } from './schools'

describe('school registry', () => {
  it('has a unique id per school and a valid default', () => {
    const ids = SCHOOLS.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(getSchool(DEFAULT_SCHOOL_ID)).toBeDefined()
  })

  it('Michigan is available and carries a basketball dataset', () => {
    const m = getSchool('michigan')!
    expect(m.available).toBe(true)
    expect(m.basketball?.players.length ?? 0).toBeGreaterThan(0)
    expect(m.theme.accent.toLowerCase()).toBe('#ffcb05')
  })

  it('Virginia Tech is live and carries a basketball dataset', () => {
    const vt = getSchool('vt')!
    expect(vt.available).toBe(true)
    expect(vt.basketball?.players.length ?? 0).toBeGreaterThan(0)
  })

  it('a not-yet-live school is flagged unavailable with no dataset', () => {
    const unc = getSchool('unc')!
    expect(unc.available).toBe(false)
    expect(unc.basketball).toBeUndefined()
  })

  it('tracks which schools field football (VCU does not)', () => {
    expect(getSchool('vcu')!.hasFootball).toBe(false)
    expect(getSchool('michigan')!.hasFootball).toBe(true)
    expect(getSchool('vt')!.hasFootball).toBe(true)
    for (const s of SCHOOLS) expect(typeof s.hasFootball).toBe('boolean')
  })

  it('flags conference strength (only VCU is non-power-5 today)', () => {
    expect(getSchool('vcu')!.power5).toBe(false)
    for (const id of ['michigan', 'unc', 'florida', 'vt', 'pitt']) {
      expect(getSchool(id)!.power5).toBe(true)
    }
    for (const s of SCHOOLS) expect(typeof s.power5).toBe('boolean')
  })

  it('includes the coming-soon schools', () => {
    for (const id of ['unc', 'florida', 'pitt', 'vcu']) {
      expect(getSchool(id)?.available).toBe(false)
    }
  })

  it('every theme token is a hex color', () => {
    for (const s of SCHOOLS) {
      for (const v of Object.values(s.theme)) {
        expect(v).toMatch(/^#[0-9a-fA-F]{6}$/)
      }
    }
  })

  it('getSchool returns undefined for unknown ids', () => {
    expect(getSchool('nope')).toBeUndefined()
    expect(getSchool(null)).toBeUndefined()
  })

  it('applyTheme writes the four brand custom properties', () => {
    const el = document.createElement('div')
    applyTheme(
      {
        brand: '#111111',
        brand2: '#222222',
        accent: '#333333',
        ink: '#444444',
      },
      el,
    )
    expect(el.style.getPropertyValue('--brand')).toBe('#111111')
    expect(el.style.getPropertyValue('--brand-2')).toBe('#222222')
    expect(el.style.getPropertyValue('--accent')).toBe('#333333')
    expect(el.style.getPropertyValue('--ink')).toBe('#444444')
  })
})
