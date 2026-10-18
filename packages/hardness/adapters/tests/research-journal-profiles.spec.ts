import { describe, expect, it } from 'vitest'
import { journalPublicationProfile, createResearchJournalTool } from '../src/research-journal-profiles.ts'

describe('research journal article admission profiles', () => {
  it('selects official JAMA 3000-word/5-figure original investigation profile', () => {
    const profile = journalPublicationProfile('jama', 'original_investigation')
    expect(profile.manuscript_limits).toMatchObject({
      max_words: 3000, max_abstract_words: 350, max_tables_figures: 5,
    })
    expect(profile.requires).toContain('Key Points')
    expect(profile.source_url).toContain('jamanetwork.com')
    expect(profile.compliant).toBe(false)
  })
  it('treats an unknown journal as unknown instead of inventing limits', () => {
    const profile = journalPublicationProfile('custom', 'narrative_review')
    expect(profile.manuscript_limits.max_words).toBeNull()
    expect(profile.citation_style).toBeNull()
    expect(profile.warnings.join(' ')).toContain('reglamento')
    expect(createResearchJournalTool().name).toBe('phoenix_research_journal_profile')
  })
})
