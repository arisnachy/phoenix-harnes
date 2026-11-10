// @vitest-environment jsdom
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react'
import {afterEach,describe,expect,it,vi} from 'vitest'
import {SportsApiKeysSettingsTab} from '../src/client/SportsApiKeysSettingsTab.tsx'
import type {SportsApiKeysSettingsTabProps} from '../src/client/SportsApiKeysSettingsTab.tsx'
import {es,type PluginInventoryLocaleKey} from '../src/client/locales.ts'

afterEach(cleanup)
const t=((key:PluginInventoryLocaleKey)=>es[key]) as SportsApiKeysSettingsTabProps['t']
const row={id:'THERUNDOWN_API_KEY',name:'TheRundown',signup:'https://therundown.io/',
  purpose:'Pre-game bookmaker odds',configured:false,verified:false,writable:true,
  source:'none',status:'missing-key'} as const
const props=()=>({
  t,
  listSportsApiKeys:vi.fn().mockResolvedValue([row]),
  saveSportsApiKey:vi.fn().mockResolvedValue({...row,configured:true,source:'vault',
    status:'configured-unverified'}),
  removeSportsApiKey:vi.fn().mockResolvedValue(row),
  verifySportsApiKey:vi.fn().mockResolvedValue(row),
})
describe('Sports APIs trusted Connectors tab',()=>{
  it('asks for the key only in a password field, then clears the secret after save',async()=>{
    const hooks=props()
    render(<SportsApiKeysSettingsTab {...(hooks as unknown as SportsApiKeysSettingsTabProps)}/>)
    expect(await screen.findByText('TheRundown')).toBeTruthy()
    fireEvent.click(screen.getByRole('button',{name:es.sportsKeysConfigure}))
    const secure=(screen.getByLabelText(es.sportsKeysPaste) as HTMLInputElement)
    expect(secure.type).toBe('password')
    expect(secure.autocomplete).toBe('new-password')
    fireEvent.change(secure,{target:{value:'secret_test_owner_only_123456'}})
    fireEvent.click(screen.getByRole('button',{name:es.sportsKeysSave}))
    await waitFor(()=>expect(hooks.saveSportsApiKey)
      .toHaveBeenCalledWith('THERUNDOWN_API_KEY','secret_test_owner_only_123456'))
    await waitFor(()=>expect(screen.getByText(es.sportsKeysSavedUnverified)).toBeTruthy())
    expect(screen.queryByDisplayValue('secret_test_owner_only_123456')).toBeNull()
    expect(screen.getByText(es.sportsKeysUnverified)).toBeTruthy()
  })
  it('does not echo a secret when Host rejects a credential',async()=>{
    const hooks=props()
    hooks.saveSportsApiKey.mockRejectedValueOnce(Error('Provider threw secret SECRET_VALUE'))
    render(<SportsApiKeysSettingsTab {...(hooks as unknown as SportsApiKeysSettingsTabProps)}/>)
    expect(await screen.findByText('TheRundown')).toBeTruthy()
    fireEvent.click(screen.getByRole('button',{name:es.sportsKeysConfigure}))
    fireEvent.change(screen.getByLabelText(es.sportsKeysPaste),{target:{value:'SECRET_VALUE_12345'}})
    fireEvent.click(screen.getByRole('button',{name:es.sportsKeysSave}))
    await waitFor(()=>expect(screen.getByText(es.sportsKeysSaveError)).toBeTruthy())
    expect(screen.queryByText(/SECRET_VALUE/)).toBeNull()
  })
})
