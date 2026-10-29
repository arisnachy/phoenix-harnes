import { describe, expect, it } from 'vitest'
import { hasExecutableHtmlBehavior, hasExternalImageReferences, inlineBundledImages, isolatedHtmlPreviewWindow } from '../src/client/chat/html-preview-assets.ts'

describe('HARDNESS packaged HTML image assets', () => {
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4//8/AwAI/AL+e6I6JwAAAABJRU5ErkJggg=='

  it('shows attached PNGs under nested relative image paths, CSS url and srcset', () => {
    const source = '<img src="./images/hero.png" srcset="./images/hero.png 1x, ./images/alt.png 2x"><div style="background-image:url(./images/hero.png)"></div>'
    const html = inlineBundledImages('site/index.html', source, {
      'site/index.html': source,
      'site/images/hero.png': png,
      'site/images/alt.png': { base64: png, mime: 'image/png' },
    })
    expect(html).toContain('src="data:image/png;base64,')
    expect(html).toContain('srcset="data:image/png;base64,')
    expect(html).toContain('background-image:url("data:image/png;base64,')
    expect(html).not.toContain('./images/hero.png')
  })

  it('embeds companion stylesheets so background images are visible', () => {
    const html = inlineBundledImages('site/index.html',
      '<link rel="stylesheet" href="./css/theme.css"><div class="hero">Hello</div>',
      { 'site/css/theme.css': '.hero{background:url(../images/hero.png)}',
        'site/images/hero.png': png })
    expect(html).toContain('<style data-phoenix-bundled-css="true">')
    expect(html).toContain('background:url("data:image/png;base64,')
    expect(html).not.toContain('<link rel="stylesheet"')
  })

  it('preserves remote and unknown images without reading host files or escaping its bundle', () => {
    const html = inlineBundledImages('site/index.html',
      '<img src="https://images.example.test/hero.jpg"><img src="../../secret.png"><img src="./missing.jpg"><img src="javascript:alert(1)">',
      { 'site/assets/hero.png': png, '../secret.png': png })
    expect(html).toContain('https://images.example.test/hero.jpg')
    expect(html).toContain('../../secret.png')
    expect(html).toContain('./missing.jpg')
    expect(html).toContain('javascript:alert(1)')
    expect(html).not.toContain('data:image/png')
  })

  it('accepts preformatted image data URLs and refuses ambiguous MIME or malformed base64', () => {
    const html = inlineBundledImages('index.html',
      '<img src="a.webp"><img src="b.jpg"><img src="c.png">',
      { 'a.webp': 'data:image/webp;base64,QUJDRA==',
        'b.jpg': { mime: 'application/javascript', base64: png },
        'c.png': 'not valid base64?' })
    expect(html).toContain('data:image/webp;base64,QUJDRA==')
    expect(html).toContain('src="b.jpg"')
    expect(html).toContain('src="c.png"')
  })

  it('recognizes remote imagery and does not treat links or internal images as external', () => {
    expect(hasExternalImageReferences('<img src="https://images.example.com/cat.webp">')).toBe(true)
    expect(hasExternalImageReferences('<style>.hero{background-image:url(https://images.example.com/hero)}</style>')).toBe(true)
    expect(hasExternalImageReferences('<a href="https://example.com">Visitar</a>')).toBe(false)
    expect(hasExternalImageReferences('<img src="data:image/png;base64,QUJDRA==">')).toBe(false)
    expect(hasExternalImageReferences('<img src="//images.example.com/cat.webp">')).toBe(true)
  })

  it('keeps passive image-first pages separate from executable mini-apps', () => {
    expect(hasExecutableHtmlBehavior('<main><img src="https://images.example.test/hero.webp"><h1>Ideas claras</h1></main>')).toBe(false)
    expect(hasExecutableHtmlBehavior('<main><style>.hero{background:url(https://images.example.test/x.jpg)}</style></main>')).toBe(false)
    expect(hasExecutableHtmlBehavior('<script>document.body.dataset.active="1"</script>')).toBe(true)
    expect(hasExecutableHtmlBehavior('<button onclick="run()">Abrir</button>')).toBe(true)
    expect(hasExecutableHtmlBehavior('<a href="javascript:run()">Abrir</a>')).toBe(true)
  })
  it('inlines a standalone CSS file even when no raster image is present', () => {
    const page = '<link rel="stylesheet" href="theme.css"><p class="title">Kira</p>'
    const rendered = inlineBundledImages('index.html', page, {
      'theme.css': '.title { color: #a64c2e }',
    })
    expect(rendered).toContain('<style data-phoenix-bundled-css="true">')
    expect(rendered).toContain('color: #a64c2e')
  })

  it('opens untrusted HTML only inside an opaque-origin iframe in the standalone URL', () => {
    const payload = '<h1>Kira</h1><script>window.parent.alert(1)</script>'
    const windowHtml = isolatedHtmlPreviewWindow(payload, 'Sitio Kira', true)
    expect(windowHtml).toContain('srcdoc="&lt;h1&gt;Kira&lt;/h1&gt;')
    expect(windowHtml).toContain('sandbox="allow-scripts"')
    expect(windowHtml).not.toContain('allow-same-origin')
    expect(windowHtml).toContain('connect-src \\'none\\'')
    expect(isolatedHtmlPreviewWindow(payload, 'Sitio Kira', false)).toContain('sandbox=""')
    expect(isolatedHtmlPreviewWindow('<iframe src="x"></iframe>', 'A "B"', true))
      .toContain('title="A &quot;B&quot;"')
  })

})
