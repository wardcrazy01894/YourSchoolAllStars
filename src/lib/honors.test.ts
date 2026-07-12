import { describe, it, expect } from 'vitest'
import { honorEmoji, honorBadges, HONOR_LEGEND } from './honors'

describe('honorEmoji — national awards', () => {
  it('maps national player-of-the-year awards to 🏆', () => {
    expect(honorEmoji('National Player of the Year (2013)')).toBe('🏆')
    expect(honorEmoji('Wooden Award (2013)')).toBe('🏆')
    expect(honorEmoji('Naismith Player of the Year (2013)')).toBe('🏆')
    expect(honorEmoji('Oscar Robertson Trophy (2013)')).toBe('🏆')
    expect(honorEmoji('Bob Cousy Award (2013)')).toBe('🏆')
  })

  it("maps football's national trophies to 🏆 too", () => {
    expect(honorEmoji('Heisman Trophy (1997)')).toBe('🏆')
    expect(honorEmoji('Walter Camp Award (2021)')).toBe('🏆')
    expect(honorEmoji('Maxwell Award (2021)')).toBe('🏆')
    expect(honorEmoji('Lombardi Award (2021)')).toBe('🏆')
  })

  it('maps the Big Ten MVP (Silver Football) to the conference POY crown', () => {
    expect(honorEmoji('Big Ten MVP (Silver Football) (2022)')).toBe('👑')
  })

  it('maps All-American teams to the star family, one glyph per team', () => {
    expect(honorEmoji('Consensus First-Team All-American (2013)')).toBe('🌟')
    expect(honorEmoji('Consensus Second-Team All-American (1998)')).toBe('⭐')
    expect(honorEmoji('AP Third-Team All-American (2014)')).toBe('✨')
    expect(honorEmoji('NABC Second-Team All-American (2021)')).toBe('⭐')
    // Unqualified "All-American" reads as the top honor.
    expect(honorEmoji('Consensus All-American (2001)')).toBe('🌟')
    // National honorable mention shares the lowest national tier.
    expect(honorEmoji('AP All-American Honorable Mention (2013)')).toBe('✨')
  })

  it("gives McDonald's All-American (a high-school honor) its own badge", () => {
    // It contains "All-American" but is a recruiting honor, not an NCAA
    // selection — it must NOT wear the college first-team 🌟.
    expect(honorEmoji("McDonald's All-American (2021)")).toBe('🍔')
  })
})

describe('honorEmoji — conference awards', () => {
  it('maps conference player of the year to 👑', () => {
    expect(honorEmoji('Big Ten Player of the Year (2013)')).toBe('👑')
    expect(honorEmoji('ACC Player of the Year (2005)')).toBe('👑')
  })

  it('maps all-conference teams to medals by team', () => {
    expect(honorEmoji('First-Team All-Big Ten (2013)')).toBe('🥇')
    expect(honorEmoji('First-Team All-ACC (2005)')).toBe('🥇')
    expect(honorEmoji('First-Team All-Big Ten (media) (2012)')).toBe('🥇')
    expect(honorEmoji('Second-Team All-SEC (2007)')).toBe('🥈')
    expect(honorEmoji('Third-Team All-Big East (2009)')).toBe('🥉')
    expect(honorEmoji('All-ACC Honorable Mention (2019)')).toBe('🎖️')
  })
})

describe('honorEmoji — specialty awards', () => {
  it('maps defensive honors to 🛡️', () => {
    expect(honorEmoji('SEC Defensive Player of the Year (2007)')).toBe('🛡️')
    expect(honorEmoji('Big Ten All-Defensive Team (2014)')).toBe('🛡️')
    expect(honorEmoji('ACC All-Defensive Team (2010)')).toBe('🛡️')
  })

  it('maps freshman/rookie honors to 🌱', () => {
    expect(honorEmoji('Big Ten Freshman of the Year (2018)')).toBe('🌱')
    expect(honorEmoji('ACC All-Freshman Team (2006)')).toBe('🌱')
    expect(honorEmoji('CAA All-Rookie Team (2015)')).toBe('🌱')
    expect(honorEmoji('Big East Rookie of the Year (2008)')).toBe('🌱')
  })

  it('maps sixth-man awards to 🔥', () => {
    expect(honorEmoji('SEC Sixth Man of the Year (2006)')).toBe('🔥')
    expect(honorEmoji('Big Ten Sixth Man of the Year (2019)')).toBe('🔥')
  })

  it('maps tournament MVP/MOP honors to 🏅', () => {
    expect(honorEmoji('NCAA Final Four Most Outstanding Player (1989)')).toBe(
      '🏅',
    )
    expect(honorEmoji('Big Ten Tournament MVP (2017)')).toBe('🏅')
    expect(honorEmoji('Big Ten Tournament MOP (2018)')).toBe('🏅')
    expect(honorEmoji('NCAA All-Tournament Team (1993)')).toBe('🏅')
    expect(honorEmoji('NIT Most Valuable Player (vacated) (1997)')).toBe('🏅')
  })
})

describe('honorEmoji — fallback', () => {
  it('keeps the generic ★ for anything unrecognized', () => {
    expect(honorEmoji('Team MVP (2004)')).toBe('★')
    expect(honorEmoji('Team Co-Captain (2004)')).toBe('★')
    expect(honorEmoji('led Big Ten in 3PM (93) (2016)')).toBe('★')
    expect(honorEmoji('NBA 2nd-round draft pick 2007 (Indiana Pacers)')).toBe(
      '★',
    )
    expect(honorEmoji('2004 NIT Championship team')).toBe('★')
    expect(honorEmoji('Big Ten FG% champion (64.0%) (2013)')).toBe('★')
  })
})

describe('honorBadges', () => {
  it('dedupes honors that share a glyph and groups them under one badge', () => {
    const badges = honorBadges([
      'Wooden Award (2013)',
      'Naismith Player of the Year (2013)',
      'Consensus First-Team All-American (2013)',
      'Big Ten Player of the Year (2013)',
      'First-Team All-Big Ten (2013)',
    ])
    expect(badges.map((b) => b.emoji)).toEqual(['🏆', '🌟', '👑', '🥇'])
    // Both national POY awards collapse into the single 🏆 badge…
    expect(badges[0].honors).toEqual([
      'Wooden Award (2013)',
      'Naismith Player of the Year (2013)',
    ])
    // …and each other badge keeps its own honor for the tooltip.
    expect(badges[3].honors).toEqual(['First-Team All-Big Ten (2013)'])
  })

  it('orders badges most-prestigious first regardless of input order', () => {
    const badges = honorBadges([
      'Second-Team All-Big Ten (2012)',
      'Consensus Second-Team All-American (2012)',
    ])
    expect(badges.map((b) => b.emoji)).toEqual(['⭐', '🥈'])
  })

  it('returns an empty list for no honors', () => {
    expect(honorBadges([])).toEqual([])
  })
})

describe('HONOR_LEGEND', () => {
  it('covers every glyph honorEmoji can produce, exactly once', () => {
    const sample = [
      'Wooden Award (2013)',
      'Consensus First-Team All-American (2013)',
      'Consensus Second-Team All-American (1998)',
      'AP Third-Team All-American (2014)',
      'Big Ten Player of the Year (2013)',
      'First-Team All-Big Ten (2013)',
      'Second-Team All-SEC (2007)',
      'Third-Team All-Big East (2009)',
      'All-ACC Honorable Mention (2019)',
      'SEC Defensive Player of the Year (2007)',
      'Big Ten Freshman of the Year (2018)',
      'SEC Sixth Man of the Year (2006)',
      'Big Ten Tournament MVP (2017)',
      'Team MVP (2004)', // fallback ★
    ]
    const produced = new Set(sample.map(honorEmoji))
    const legend = HONOR_LEGEND.map((e) => e.emoji)
    for (const emoji of produced) expect(legend).toContain(emoji)
    expect(new Set(legend).size).toBe(legend.length)
  })

  it('pairs every glyph with a human-readable label', () => {
    for (const entry of HONOR_LEGEND) {
      expect(entry.label.length).toBeGreaterThan(3)
    }
  })

  it('leads with the most prestigious badge (national POY)', () => {
    expect(HONOR_LEGEND[0]).toEqual({
      emoji: '🏆',
      label: 'National Player of the Year',
    })
  })
})
