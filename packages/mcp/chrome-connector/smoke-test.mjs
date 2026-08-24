import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const child = spawn(process.execPath, ['--import', 'tsx/esm', 'packages/mcp/chrome-connector/src/server.ts'], { cwd: fileURLToPath(new URL('../../..', import.meta.url)), stdio: ['pipe', 'pipe', 'inherit'] })
let buffer = ''
const waitFor = (id) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`timeout waiting for ${id}`)), 10000)
  const onData = chunk => {
    buffer += chunk.toString()
    const lines = buffer.split('\n'); buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.trim()) continue
      const msg = JSON.parse(line)
      if (msg.id === id) { clearTimeout(timer); child.stdout.off('data', onData); resolve(msg) }
    }
  }
  child.stdout.on('data', onData)
})
const send = (id, method, params = {}) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
send(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'smoke', version: '1' } })
console.log(JSON.stringify(await waitFor(1)))
send(2, 'tools/list')
const listed = await waitFor(2)
console.log(JSON.stringify({ tools: listed.result?.tools?.map(t => t.name) }))
send(3, 'tools/call', { name: 'status', arguments: {} })
console.log(JSON.stringify(await waitFor(3)))
send(4, 'tools/call', { name: 'tabs', arguments: {} })
const tabResult = await waitFor(4)
console.log(JSON.stringify({ tabs: JSON.parse(tabResult.result.content[0].text).map(t => ({ id: t.id, url: t.url })) }))
const tabId = JSON.parse(tabResult.result.content[0].text)[0]?.id
send(5, 'tools/call', { name: 'navigate', arguments: { url: 'https://example.com', tabId } })
console.log(JSON.stringify(await waitFor(5)))
await new Promise(resolve => setTimeout(resolve, 1500))
send(6, 'tools/call', { name: 'read_page', arguments: { tabId, maxChars: 500 } })
console.log(JSON.stringify(await waitFor(6)))
send(7, 'tools/call', { name: 'navigate', arguments: { url: 'https://chatgpt.com/work/extension/installed', tabId } })
console.log(JSON.stringify(await waitFor(7)))
child.kill()
