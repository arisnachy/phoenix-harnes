import { zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { projectFileContent } from '../src/file-content.ts'

const encoder = new TextEncoder()

function ref(mediaType: string, name: string): { mediaType: string; name: string } {
  return { mediaType, name }
}

describe('projectFileContent', () => {
  it('projects bounded UTF-8 text and marks truncation', () => {
    const projection = projectFileContent(ref('text/plain', 'notes.txt'), encoder.encode('alpha beta'), 5)

    expect(projection).toEqual({ text: 'alpha', format: 'text', truncated: true })
  })

  it('rejects malformed UTF-8 declared as text', () => {
    expect(() => projectFileContent(ref('text/plain', 'notes.txt'), Uint8Array.of(0xc3, 0x28), 100))
      .toThrow()
  })

  it('extracts readable PDF text from an uncompressed text stream', () => {
    const data = encoder.encode('%PDF-1.7\nBT\n(Hello \\(Phoenix\\)) Tj\n(World) Tj\nET')

    expect(projectFileContent(ref('application/pdf', 'brief.pdf'), data, 100)).toMatchObject({
      format: 'pdf',
      text: 'Hello (Phoenix) World',
      truncated: false,
    })
  })

  it('extracts text from DOCX, XLSX, and PPTX Open XML parts', () => {
    const docx = zipSync({ 'word/document.xml': encoder.encode('<w:document><w:t>Project Phoenix</w:t></w:document>') })
    const xlsx = zipSync({
      'xl/sharedStrings.xml': encoder.encode('<sst><si><t>Revenue</t></si></sst>'),
      'xl/worksheets/sheet1.xml': encoder.encode('<worksheet><row><c><v>42</v></c></row></worksheet>'),
    })
    const pptx = zipSync({ 'ppt/slides/slide1.xml': encoder.encode('<p:sld><a:t>Launch plan</a:t></p:sld>') })

    expect(projectFileContent(ref('application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'brief.docx'), docx, 100)?.text)
      .toBe('Project Phoenix')
    expect(projectFileContent(ref('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'data.xlsx'), xlsx, 100)?.text)
      .toBe('Revenue 42')
    expect(projectFileContent(ref('application/vnd.openxmlformats-officedocument.presentationml.presentation', 'plan.pptx'), pptx, 100)?.text)
      .toBe('Launch plan')
  })

  it('recovers long printable runs from otherwise unsupported binary files', () => {
    const data = Uint8Array.from([0, ...encoder.encode('embedded diagnostic text'), 0, 255])

    expect(projectFileContent(ref('application/octet-stream', 'dump.bin'), data, 100)).toMatchObject({
      format: 'printable-binary',
      text: 'embedded diagnostic text',
    })
  })

  it('does not invent content for opaque binary data', () => {
    expect(projectFileContent(ref('application/octet-stream', 'blob.bin'), Uint8Array.of(0, 1, 2, 3), 100))
      .toBeUndefined()
  })
})
