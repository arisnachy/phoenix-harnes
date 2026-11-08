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
     canInstall:true,phase:'missing',detail:'Docker Desktop required'}],
  })
  render(<AnatomyConnectorsSettingsTab {...({t,installAnatomy,listAnatomy} as unknown as AnatomyConnectorsSettingsTabProps)}/>)
  expect(await screen.findByText('TotalSegmentator')).toBeTruthy()
  const checkboxes=screen.getAllByRole('checkbox') as HTMLInputElement[]
  expect(checkboxes).toHaveLength(2)
  expect(checkboxes[0]?.checked).toBe(false)
  expect(checkboxes[0]?.disabled).toBe(true)
  fireEvent.click(screen.getAllByRole('button',{name:en.anatomyInstall})[0]!)
  await waitFor(()=>expect(installAnatomy).toHaveBeenCalledWith('totalsegmentator'))
  fireEvent.click(screen.getAllByRole('button',{name:en.anatomyInstall})[1]!)
  await waitFor(()=>expect(installAnatomy).toHaveBeenCalledWith('opencarp'))
 })
 it('launches one host-managed bulk job and shows sequential progress',async()=>{
  const installAnatomy=vi.fn().mockResolvedValue({id:'all',status:'started',detail:'queued'})
  const listAnatomy=vi.fn().mockResolvedValue({
   running:false,readyCount:0,clinicalValidation:'not-validated',
   progress:{completed:2,total:7,current:'totalsegmentator',status:'running'},
   entries:[{id:'totalsegmentator',title:'TotalSegmentator',installed:false,operational:false,
     canInstall:true,phase:'missing',detail:'Needs weights'}]
  })
  render(<AnatomyConnectorsSettingsTab {...({t,installAnatomy,listAnatomy} as unknown as AnatomyConnectorsSettingsTabProps)}/>)
  const button=await screen.findByRole('button',{name:en.anatomyInstallAll})
  fireEvent.click(button)
  await waitFor(()=>expect(installAnatomy).toHaveBeenCalledTimes(1))
  expect(installAnatomy).toHaveBeenCalledWith('all')
  expect(screen.getByText(/2\/7/)).toBeTruthy()
 })

})
