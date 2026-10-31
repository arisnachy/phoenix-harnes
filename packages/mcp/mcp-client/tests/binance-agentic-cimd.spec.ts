import { readFileSync } from 'node:fs'
import { describe,expect,it } from 'vitest'
import {
  PHOENIX_BINANCE_AGENTIC_CIMD_ID,binanceAgenticCimdClientId,
} from '../src/binance-agentic-cimd.ts'
import { McpOAuthCallbackServer } from '../src/oauth.ts'

const official={
  serverName:'binance-agent-os',
  transport:'streamable-http',
  url:'https://agent.binance.com/mcp/agentic',
  oauth:true,
} as const

describe('PHOENIX Binance Agentic OAuth CIMD (no dynamic client registration)',()=>{
  it('selects its own public client identity only for the pinned official Binance server',()=>{
    expect(binanceAgenticCimdClientId(official)).toBe(PHOENIX_BINANCE_AGENTIC_CIMD_ID)
    expect(binanceAgenticCimdClientId({ ...official,url:'https://impostor.example/mcp' })).toBeUndefined()
    expect(binanceAgenticCimdClientId({ ...official,serverName:'other-agent' })).toBeUndefined()
    expect(binanceAgenticCimdClientId({ ...official,oauth:false })).toBeUndefined()
    expect(binanceAgenticCimdClientId({ ...official,oauthClientIdRef:'CUSTOM_CLIENT' })).toBeUndefined()
    expect(binanceAgenticCimdClientId({ ...official,oauthClientSecretRef:'CUSTOM_SECRET' })).toBeUndefined()
    expect(binanceAgenticCimdClientId({ ...official,transport:'stdio' })).toBeUndefined()
    expect(PHOENIX_BINANCE_AGENTIC_CIMD_ID).not.toContain('chatgpt.com')
    expect(PHOENIX_BINANCE_AGENTIC_CIMD_ID).not.toContain('codex')
    expect(PHOENIX_BINANCE_AGENTIC_CIMD_ID).toMatch(/^https:\/\/cdn\.jsdelivr\.net\//u)
  })
  it('publishes a client metadata document matched to the actual Host loopback callback',async()=>{
    const json=JSON.parse(readFileSync(
      new URL('../../../../website/public/oauth/binance-agentic-client.json',import.meta.url),'utf8',
    )) as Record<string,unknown>
    expect(json).toMatchObject({
      client_id:PHOENIX_BINANCE_AGENTIC_CIMD_ID,
      token_endpoint_auth_method:'none',
      grant_types:['authorization_code'],
      response_types:['code'],
      redirect_uris:['http://127.0.0.1/mcp/oauth/binance-agent-os'],
    })
    expect(JSON.stringify(json)).not.toContain('client_secret')
    const callback=new McpOAuthCallbackServer('binance-agent-os')
    try {
      await callback.start()
      const uri=new URL(callback.redirectUri)
      const metadataUri=new URL((json.redirect_uris as string[])[0]!)
      expect(uri.protocol).toBe('http:')
      expect(uri.hostname).toBe('127.0.0.1')
      expect(uri.pathname).toBe(metadataUri.pathname)
      expect(metadataUri.port).toBe('')
    }finally{await callback.close()}
  })
})
