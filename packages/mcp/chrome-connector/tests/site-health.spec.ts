import { describe, expect, it } from 'vitest'
import { classifySiteHealth, nextSiteRecoveryStep, siteHealthExpression, type SitePageHealth } from '../src/site-health.ts'

function page(changes: Partial<SitePageHealth> = {}): SitePageHealth {
  return {
    readyState: 'complete',
    hasPasswordForm: false,
    mainTextLength: 0,
    visibleTextLength: 70,
    blockedMarker: false,
    iframeCount: 0,
    crossOriginFrames: 0,
    firstPartyResourceFailures: 0,
    scriptCount: 8,
    ...changes,
  }
}

describe('Chrome partial or blocked page diagnosis', () => {
  it('distinguishes a blank market from a server-side access denial', () => {
    expect(classifySiteHealth(page())).toBe('blank_or_unrendered')
    expect(classifySiteHealth(page({ blockedMarker: true, visibleTextLength: 8 }))).toBe('page_reports_blocked')
    expect(classifySiteHealth(page({ blockedMarker: true, mainTextLength: 250 }))).toBe('partial_or_embedded_block')
    expect(classifySiteHealth(page({ blockedMarker: true, crossOriginFrames: 1, iframeCount: 1 })))
      .toBe('partial_or_embedded_block')
  })
  it('does not treat valid content, loading or failed first-party resources as equivalent', () => {
    expect(classifySiteHealth(page({ mainTextLength: 700 }))).toBe('content_visible')
    expect(classifySiteHealth(page({ readyState: 'loading' }))).toBe('loading')
    expect(classifySiteHealth(page({ firstPartyResourceFailures: 3 }))).toBe('resource_failure')
    expect(nextSiteRecoveryStep('page_reports_blocked')).toContain('No eludir')
    expect(nextSiteRecoveryStep('partial_or_embedded_block')).toContain('iframe')
  })
  it('never serializes credentials, private page content, or raw resource addresses', () => {
    expect(siteHealthExpression).not.toContain('document.cookie')
    expect(siteHealthExpression).not.toContain('localStorage')
    expect(siteHealthExpression).not.toContain('sessionStorage')
    expect(siteHealthExpression).not.toContain('input.value')
    expect(siteHealthExpression).not.toContain('resource.name)')
    expect(siteHealthExpression).toContain('firstPartyResourceFailures')
  })
})
