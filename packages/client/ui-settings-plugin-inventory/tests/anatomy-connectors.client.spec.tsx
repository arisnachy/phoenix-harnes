// @vitest-environment jsdom
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react'
import {afterEach,describe,expect,it,vi} from 'vitest'
import {AnatomyConnectorsSettingsTab} from '../src/client/AnatomyConnectorsSettingsTab.tsx'
import type {AnatomyConnectorsSettingsTabProps} from '../src/client/AnatomyConnectorsSettingsTab.tsx'
import {en,type PluginInventoryLocaleKey} from '../src/client/locales.ts'
const t=((key:PluginInventoryLocaleKey)=>en[key]) as AnatomyConnectorsSettingsTabProps['t']
afterEach(cleanup)
describe('Anatomy Connectors Settings',()=>{
 it('only marks verified installed packages and invokes allowed installer on click',async()=>{
  const installAnatomy=vi.fn().mockResolvedValue({id:'totalsegmentator',status:'started',detail:'started locally'})
  const listAnatomy=vi.fn().mockResolvedValue({
   running:false,readyCount:0,clinicalValidation:'not-validated',
   entries:[{id:'totalsegmentator',title:'TotalSegmentator',installed:false,operational:false,
     canInstall:true,phase:'missing',detail:'Python packages not ready'},
     {id:'opencarp',title:'openCARP',installed:false,operational:false,
     canInstall:false,phase:'external',detail:'WSL2 required'}],
  })
  render(<AnatomyConnectorsSettingsTab {...({t,installAnatomy,listAnatomy} as unknown as AnatomyConnectorsSettingsTabProps)}/>)
  expect(await screen.findByText('TotalSegmentator')).toBeTruthy()
  const checkboxes=screen.getAllByRole('checkbox') as HTMLInputElement[]
  expect(checkboxes).toHaveLength(2)
  expect(checkboxes[0]?.checked).toBe(false)
  expect(checkboxes[0]?.disabled).toBe(true)
  fireEvent.click(screen.getByRole('button',{name:en.anatomyInstall}))
  await waitFor(()=>expect(installAnatomy).toHaveBeenCalledWith('totalsegmentator'))
  expect(screen.queryByRole('button',{name:'Install openCARP'})).toBeNull()
 })
})
