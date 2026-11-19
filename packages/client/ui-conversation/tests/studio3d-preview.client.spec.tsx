// @vitest-environment jsdom
import { cleanup,render,screen } from '@testing-library/react'
import { afterEach,describe,expect,it } from 'vitest'
import { Studio3DPreview,parseStudio3DArtifact } from '../src/client/chat/Studio3DPreview.tsx'
import { HardnessArtifactBody } from '../src/client/chat/HardnessArtifactBody.tsx'
import { normalizeHardnessArtifact } from '../src/client/artifact.ts'

const token='b'.repeat(48)
const root='/phoenix-studio3d/assets/'+token+'/'
const artifact={
  renderUrl:root+'render.png',
  modelUrl:root+'scene.glb',
  projectUrl:root+'scene.blend',
  animationUrl:root+'animation.mp4',
}
afterEach(cleanup)
describe('Blender Studio chat artifact',()=>{
  it('classifies studio assets as a native visual instead of raw JSON',()=>{
    const result=normalizeHardnessArtifact({
      id:'studio-fixture',title:'Studio',mime:'application/vnd.phoenix.studio3d+json',
      data:artifact,executable:false,
    })
    expect(result.kind).toBe('visual')
    expect(result.executable).toBe(false)
  })
  it('shows the verified Cycles render and actual GLB, blend and MP4 links',()=>{
    render(<HardnessArtifactBody mime="application/vnd.phoenix.studio3d+json"
      data={artifact} expanded={false} title="Modelo de producción"/>)
    expect(screen.getByAltText('Render real de Blender: Modelo de producción').getAttribute('src'))
      .toBe(artifact.renderUrl)
    expect(screen.getByText('Modelo GLB').getAttribute('href')).toBe(artifact.modelUrl)
    expect(screen.getByText('Proyecto Blender').getAttribute('href')).toBe(artifact.projectUrl)
    expect(screen.getByText('Animación MP4').getAttribute('href')).toBe(artifact.animationUrl)
    expect(document.querySelector('canvas')).toBeNull()
  })
  it('rejects rogue external URLs, mismatched tokens and non-Blender payload',()=>{
    expect(parseStudio3DArtifact({...artifact,renderUrl:'https://remote.invalid/evil.png'})).toBeUndefined()
    expect(parseStudio3DArtifact({...artifact,modelUrl:'/phoenix-studio3d/assets/'+ 'a'.repeat(48)+'/scene.glb'})).toBeUndefined()
    expect(parseStudio3DArtifact({...artifact,modelUrl:'javascript:alert(1)'})).toBeUndefined()
    render(<Studio3DPreview value={{...artifact,renderUrl:'data:image/png;base64,AAAA'}} title="Error"/>)
    expect(screen.getByRole('alert')).toBeTruthy()
  })
})
