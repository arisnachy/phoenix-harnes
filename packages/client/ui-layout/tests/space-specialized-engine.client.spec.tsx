// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { spaceGodotUrl, spaceHtmlSource } from '../src/client/PhoenixSpace.tsx'
import { detectFile } from '../src/client/UniversalFileEngine.tsx'
import { readDicomPreview, readTarNames, specializedFormat } from '../src/client/SpecializedFileFormats.tsx'
describe('specialized engines',()=>{
  it('accepts only validated local Godot exports',()=>{
    const url='/phoenix-games/godot/'+'a'.repeat(48)+'/index.html'
    expect(spaceGodotUrl(JSON.stringify({engine:'godot',structureChecked:true,url}))).toBe(url)
    expect(spaceGodotUrl(JSON.stringify({engine:'godot',structureChecked:true,url:'https://evil.example/'}))).toBeUndefined()
    expect(spaceGodotUrl(JSON.stringify({engine:'godot',structureChecked:false,url}))).toBeUndefined()
  })
  it('resolves local classic game scripts without external requests',()=>{
    const html=spaceHtmlSource(JSON.stringify({entry:'game/index.html',files:{'game/index.html':'<script src="game.js"></script><script src="https://evil.example/a.js"></script>','game/game.js':'window.gameReady=true'}}))
    expect(html).toContain('<script>window.gameReady=true</script>')
    expect(html).toContain('src="https://evil.example/a.js"')
  })
  it('routes GLB, DICOM and recognized specialist formats',()=>{
    expect(detectFile(new TextEncoder().encode('glTF'),'renamed.bin','application/octet-stream').mode).toBe('model')
    const dcm=new Uint8Array(132);dcm.set(new TextEncoder().encode('DICM'),128)
    expect(detectFile(dcm,'scan.bin','application/octet-stream').mode).toBe('dicom')
    expect(()=>readDicomPreview(dcm)).toThrow()
    expect(specializedFormat('scene.blend')?.adapter).toContain('Blender')
    expect(specializedFormat('installer.exe')?.internal).toBe(false)
  })
  it('lists TAR entries without filesystem extraction',()=>{
    const tar=new Uint8Array(1024),enc=new TextEncoder()
    tar.set(enc.encode('../outside.txt'),0);tar.set(enc.encode('00000000000'),124)
    expect(readTarNames(tar)).toEqual([{name:'../outside.txt',size:0}])
  })
})
