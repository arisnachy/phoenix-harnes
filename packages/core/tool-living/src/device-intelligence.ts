/** Local, bounded device discovery and Android service diagnostics. */
import { execFile } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import process from 'node:process'

type Result = { ok: boolean; stdout: string }
type Runner = (file: string, args: string[]) => Promise<Result>
const runLocal: Runner = (file, args) => new Promise(resolve => {
  execFile(file, args, { encoding: 'utf8', windowsHide: true, timeout: 5000, maxBuffer: 131072, shell: false },
    (error, stdout) => resolve({ ok: !error, stdout: error ? '' : stdout }))
})
const PNP = "$ErrorActionPreference='Stop'; @(Get-PnpDevice -PresentOnly | Where-Object {$_.Class -in @('USB','Bluetooth','WPD','Monitor','AudioEndpoint','Media','Printer','Net','DiskDrive','Camera','Image','Ports')} | Group-Object Class,Status | Select-Object -First 64 @{n='class';e={$_.Group[0].Class}},@{n='status';e={$_.Group[0].Status}},Count) | ConvertTo-Json -Compress"
const clean = (value: string) => value.replace(/[\x00-\x1f\x7f]/gu, '').trim().slice(0, 100)
const classes = new Set(['USB','Bluetooth','WPD','Monitor','AudioEndpoint','Media','Printer','Net','DiskDrive','Camera','Image','Ports'])
type Android = { serial: string; target: string; state: string; model: string | null }
export class DeviceIntelligence {
  private readonly salt = randomBytes(32)
  constructor(private readonly run: Runner = runLocal, private readonly platform: string = process.platform) {}
  private async call(file: string, args: string[]): Promise<Result> {
    try { return await this.run(file, args) } catch { return { ok: false, stdout: '' } }
  }
  private async android() {
    const result = await this.call('adb', ['devices','-l'])
    const devices: Android[] = []
    if (result.ok) for (const line of result.stdout.split(/\r?\n/u).slice(0, 128)) {
      const match = /^([A-Za-z0-9_-]{1,120})\s+(device|offline|unauthorized|recovery|sideload|bootloader)(?:\s+(.*))?$/u.exec(line.trim())
      // Do not use network addresses, mDNS endpoints or emulators. ADB authorization remains authoritative.
      if (!match || match[1]!.startsWith('emulator-')) continue
      const serial = match[1]!
      if (devices.some(d => d.serial === serial)) continue
      const model = /(?:^|\s)model:([A-Za-z0-9_.-]{1,100})(?:\s|$)/u.exec(match[3] ?? '')?.[1] ?? null
      devices.push({ serial, target: createHash('sha256').update(this.salt).update(serial).digest('hex').slice(0, 24), state: match[2]!, model })
    }
    return { ok: result.ok, devices: devices.slice(0, 32) }
  }
  async inventory() {
    const pnp = this.platform === 'win32'
      ? this.call('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(PNP,'utf16le').toString('base64')])
      : Promise.resolve({ok:false,stdout:''})
    const [windows, adb] = await Promise.all([pnp,this.android()])
    let groups: { class: string; status: string; count: number }[] = []
    let pnpState = windows.ok ? 'completed' : 'unavailable'
    if (windows.ok) try {
      const value: unknown = JSON.parse(windows.stdout.trim().replace(/^\uFEFF/u,'') || 'null')
      const rows = Array.isArray(value) ? value : value === null ? [] : [value]
      groups = rows.slice(0,64).flatMap(row => {
        if (!row || typeof row !== 'object' || !classes.has(row.class) || !Number.isSafeInteger(row.Count) || row.Count < 1 || row.Count > 100000) return []
        return [{class:row.class,status:['OK','Error','Degraded','Unknown'].includes(row.status) ? row.status : 'Unknown',count:row.Count}]
      })
    } catch { pnpState = 'invalid-output' }
    return { schema:'phoenix.device-intelligence.v1', windows:{state:pnpState,groups},
      android:{state:adb.ok?'completed':'adb-unavailable',devices:adb.devices.map(({target,state,model})=>({target,state,model}))},
      limitations:['PnP groups include internal peripherals; detection is not proof of external access or health.','ADB may start its local server; no remote connection is initiated.','Device labels are untrusted data. No serials, addresses or credentials are returned.','Network, firmware flashing, account recovery and non-Android repair adapters are not implemented.'] }
  }
  async diagnose(target: string) {
    const adb = await this.android()
    const device = adb.devices.find(d => d.target === target)
    if (!device || device.state !== 'device') return {status:'unavailable',reason:'TARGET_NOT_AUTHORIZED_OR_CHANGED'}
    const [model, version, battery] = await Promise.all([
      this.call('adb',['-s',device.serial,'shell','getprop','ro.product.model']),
      this.call('adb',['-s',device.serial,'shell','getprop','ro.build.version.release']),
      this.call('adb',['-s',device.serial,'shell','dumpsys','battery']),
    ])
    const field = (name: string, min: number, max: number) => {
      if (!battery.ok) return null
      const value = new RegExp('^\\s*'+name+':\\s*(-?\\d+)\\s*$','mu').exec(battery.stdout)?.[1]
      const n = value === undefined ? NaN : Number(value)
      return Number.isInteger(n) && n >= min && n <= max ? n : null
    }
    return {status:model.ok && version.ok && battery.ok?'completed':'partial',target,
      model:model.ok?clean(model.stdout):null,androidVersion:version.ok?clean(version.stdout):null,
      battery:{levelPercent:field('level',0,100),temperatureDeciC:field('temperature',-300,1000),healthCode:field('health',1,7)},
      nextStep:'If a reboot is appropriate, request one-time human approval. No health diagnosis from charge or temperature alone.'}
  }
  async reboot(target: string, approve: (detail: {target:string;model:string|null;effect:string})=>Promise<boolean>, signal?: AbortSignal) {
    const before = (await this.android()).devices.find(d=>d.target===target && d.state==='device')
    if (!before || signal?.aborted) return {status:'denied',reason:'TARGET_NOT_AUTHORIZED_OR_CHANGED'}
    if (!await approve({target,model:before.model,effect:'Normal Android restart; interrupts current work. Save unsaved data first.'}) || signal?.aborted)
      return {status:'denied',reason:'HUMAN_APPROVAL_NOT_GIVEN'}
    const after = (await this.android()).devices.find(d=>d.target===target && d.state==='device')
    if (!after || after.serial!==before.serial || after.model!==before.model || signal?.aborted) return {status:'denied',reason:'TARGET_CHANGED'}
    const result = await this.call('adb',['-s',after.serial,'reboot'])
    return {status:result.ok?'command-accepted':'unknown-outcome',target,verified:false,
      nextStep:'Check the physical device and rerun inventory after it reconnects; do not automatically retry.'}
  }
}
