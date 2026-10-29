// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BinanceConnectorSetup } from '../src/client/BinanceConnectorSetup.tsx'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const response = (value: object, status = 200): Response =>
  new Response(JSON.stringify(value), {status, headers: {'Content-Type':'application/json'}})

describe('Binance authenticated connector in Phoenix Settings', () => {
  it('validates production keys in REAL read-only mode without calling the Testnet credential route', async () => {
    const key='PROD_HMAC_KEY_9876543210'
    const secret='PROD_HMAC_SECRET_9876543210'
    let configured=false
    const fetcher=vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url=String(input)
      if(url.endsWith('/testnet-status'))return response({configured:false,connected:false})
      if(url.endsWith('/mcp-status'))return response({configured:false,connected:false,status:'disconnected',toolCount:0,accountVerified:false,tradeScopeVerified:false})
      if(url.endsWith('/real-status'))return response({configured,connected:configured,canRead:configured,tradingAuthorized:false})
      if(url.endsWith('/real-connect')) {
        const payload=JSON.parse(String(init?.body)) as {apiKey:string;secret:string}
        expect(payload).toEqual({apiKey:key,secret})
        expect(init?.credentials).toBe('same-origin')
        configured=true
        return response({saved:true,configured:true,connected:true,canRead:true,tradingAuthorized:false})
      }
      throw new Error('Unexpected route')
    })
    vi.stubGlobal('fetch',fetcher)
    render(<BinanceConnectorSetup onChanged={vi.fn()}/>)
    fireEvent.click(screen.getByRole('button',{name:'Conectar / autenticar Binance'}))
    await screen.findByText('Cuenta REAL no configurada')
    fireEvent.change(screen.getByPlaceholderText('API Key de Binance REAL'), {target:{value:key}})
    fireEvent.change(screen.getByPlaceholderText('Se guarda cifrado en la bóveda del Host'), {target:{value:secret}})
    fireEvent.click(screen.getByRole('button',{name:'Guardar y verificar REAL (lectura)'}))
    await screen.findByText('Binance REAL autenticado para SOLO LECTURA. No se habilitan órdenes reales.')
    expect(fetcher.mock.calls.filter(([url])=>String(url).endsWith('/real-connect'))).toHaveLength(1)
    expect(fetcher.mock.calls.filter(([url])=>String(url).endsWith('/testnet-connect'))).toHaveLength(0)
    expect(document.body.textContent).not.toContain(secret)
  })

  it('sends Testnet HMAC keys only to same-origin Host vault and clears the form once saved', async () => {
    const key = 'TESTNET_KEY_9876543210'
    const secret = 'TESTNET_SECRET_9876543210'
    const calls: Array<{url:string;init?:RequestInit}> = []
    let saved = false
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      calls.push({url,...(init === undefined ? {} : {init})})
      if (url.endsWith('/real-status')) {
        return response({configured:false,connected:false,canRead:false,tradingAuthorized:false})
      }
      if (url.endsWith('/mcp-status')) {
        return response({ configured:false, connected:false, status:'disconnected', toolCount:0,
          accountVerified:false, tradeScopeVerified:false })
      }
      if (url.endsWith('/testnet-status')) {
        return response({ configured:saved, connected:saved, canTrade:saved })
      }
      if (url.endsWith('/testnet-connect')) {
        saved = true
        return response({ saved:true, configured:true, connected:true, canTrade:true,
          nextAction:'Testnet ready' })
      }
      throw new Error('Unexpected Host endpoint')
    })
    vi.stubGlobal('fetch', fetcher)
    const onChanged = vi.fn()
    render(<BinanceConnectorSetup onChanged={onChanged}/>)
    expect(fetcher).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button',{name:'Conectar / autenticar Binance'}))
    await screen.findByText('Claves Testnet no configuradas')
    fireEvent.change(screen.getByPlaceholderText('Pega tu clave Testnet, nunca tu clave REAL'), {
      target:{value:key},
    })
    fireEvent.change(screen.getByPlaceholderText('El secreto solo se envía a la bóveda del Host'), {
      target:{value:secret},
    })
    fireEvent.click(screen.getByRole('button',{name:'Guardar y verificar Testnet'}))
    await screen.findByText('Claves guardadas y cuenta Spot Testnet autenticada.')
    expect(onChanged).toHaveBeenCalledOnce()
    const sent = calls.filter(call => call.init?.method === 'POST')
    expect(sent).toHaveLength(1)
    expect(sent[0]?.url).toBe('/phoenix-trading/paper/testnet-connect')
    expect(sent[0]?.init?.credentials).toBe('same-origin')
    expect(JSON.parse(String(sent[0]?.init?.body))).toEqual({apiKey:key,secret})
    expect((screen.getByPlaceholderText('Pega tu clave Testnet, nunca tu clave REAL') as HTMLInputElement).value).toBe('')
    expect((screen.getByPlaceholderText('El secreto solo se envía a la bóveda del Host') as HTMLInputElement).value).toBe('')
    expect(document.body.textContent).not.toContain(secret)
    expect(calls.every(call => call.init?.cache === 'no-store')).toBe(true)
  })

  it('installs the pinned REAL Agentic MCP but never claims that OAuth or account trading is authorized', async () => {
    const calls: Array<{url:string;body?:BodyInit|null}> = []
    let installed = false
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      calls.push({url,...(init?.body===undefined?{}:{body:init.body})})
      if (url.endsWith('/testnet-status')) return response({configured:false,connected:false})
      if (url.endsWith('/real-status')) return response({configured:false,connected:false,canRead:false,tradingAuthorized:false})
      if (url.endsWith('/mcp-status')) return response({
        configured:installed, connected:false, status:installed?'auth-required':'disconnected',
        toolCount:0, accountVerified:false, tradeScopeVerified:false,
      })
      if (url.endsWith('/mcp-activate')) {
        installed = true
        return response({ installed:true, status:'installed', configured:true,
          mcpStatus:'auth-required', accountVerified:false, tradeScopeVerified:false })
      }
      throw new Error('Unexpected endpoint')
    })
    vi.stubGlobal('fetch',fetcher)
    const onChanged=vi.fn()
    render(<BinanceConnectorSetup onChanged={onChanged}/>)
    fireEvent.click(screen.getByRole('button',{name:'Conectar / autenticar Binance'}))
    await screen.findByText('MCP oficial pendiente de instalar')
    fireEvent.click(screen.getByRole('button',{name:'Preparar OAuth REAL'}))
    await screen.findByText(/MCP oficial preparado. Pulsa Autorizar/)
    expect(onChanged).toHaveBeenCalledOnce()
    const installation = calls.filter(call => call.url.endsWith('/mcp-activate'))
    expect(installation).toHaveLength(1)
    expect(installation[0]?.body).toBe('{}')
    expect(screen.getByText('MCP instalado · OAuth o conexión pendiente')).toBeTruthy()
    expect(document.body.textContent).not.toContain('cuenta REAL autenticada')
  })
})
