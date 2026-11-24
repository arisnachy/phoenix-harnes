import {describe,it,expect} from 'vitest'
import {nativeDocumentExtension} from '../src/space-routes.ts'
describe('native file admission',()=>{
  it('allows supported document extensions and rejects executable or script aliases',()=>{
    expect(nativeDocumentExtension('report.PDF',Buffer.from('%PDF-1.7'))).toBe('.pdf')
    expect(nativeDocumentExtension('game.exe',Buffer.from('MZ'))).toBeUndefined()
    expect(nativeDocumentExtension('fake.pdf',Buffer.from('MZ'))).toBeUndefined()
    expect(nativeDocumentExtension('fake.txt',Buffer.from('#!/bin/sh'))).toBeUndefined()
    expect(nativeDocumentExtension('launch.ps1',Buffer.from('hello'))).toBeUndefined()
    expect(nativeDocumentExtension('unknown.bin',Buffer.from('hello'))).toBeUndefined()
  })
})
