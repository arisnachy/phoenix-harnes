import { describe, expect, it, vi } from 'vitest'
import {
  OpenClawConnectorController,
  type OpenClawCommandRunner,
} from '../src/openclaw-connectors.ts'

function runner(overrides: Partial<OpenClawCommandRunner> = {}): OpenClawCommandRunner {
  return {
    run: vi.fn(async (command: string, args: readonly string[]) => {
      if (command === 'gh') return { status: 1, stdout: '', stderr: 'not logged in' }
      if (command === 'gog') return { status: 0, stdout: '{"accounts":[]}', stderr: '' }
      return { status: 127, stdout: '', stderr: 'missing' }
    }),
    start: vi.fn(async () => ({ started: true })),
    ...overrides,
  }
}

describe('OpenClaw connector controller', () => {
  it('probes Google Workspace and GitHub with exact OpenClaw runtimes', async () => {
    const commands = runner()
    const controller = new OpenClawConnectorController(commands)

    await expect(controller.snapshot()).resolves.toEqual({
      connectors: [
        expect.objectContaining({
          id: 'google-workspace',
          source: 'openclaw',
          skill: 'gog',
          runtime: 'gog',
          status: 'auth-required',
        }),
        expect.objectContaining({
          id: 'github',
          source: 'openclaw',
          skill: 'github',
          runtime: 'gh',
          status: 'auth-required',
        }),
      ],
    })
    expect(commands.run).toHaveBeenCalledWith(
      'gog',
      ['auth', 'list', '--check', '--json', '--no-input'],
    )
    expect(commands.run).toHaveBeenCalledWith('gh', ['api', 'user', '--jq', '.login'])
  })

  it('starts GitHub browser auth with a fixed argument vector and no shell input', async () => {
    const commands = runner()
    const controller = new OpenClawConnectorController(commands)

    await expect(controller.authorize({ id: 'github' })).resolves.toEqual({ started: true })
    expect(commands.start).toHaveBeenCalledWith('gh', [
      'auth', 'login', '--web', '--hostname', 'github.com',
      '--git-protocol', 'https', '--skip-ssh-key',
    ])
  })

  it('starts Google Workspace auth only for a validated email and fixed service scope', async () => {
    const commands = runner()
    const controller = new OpenClawConnectorController(commands)

    await expect(controller.authorize({ id: 'google-workspace', account: 'owner@example.com' }))
      .resolves.toEqual({ started: true })
    expect(commands.start).toHaveBeenCalledWith('gog', [
      'auth', 'add', 'owner@example.com', '--services',
      'gmail,calendar,drive,contacts,docs,sheets', '--force-consent',
    ])
    await expect(controller.authorize({ id: 'google-workspace', account: 'bad --flag' }))
      .rejects.toThrow(/valid Google account email/i)
  })

  it('reports a missing runtime without turning it into an authorization failure', async () => {
    const commands = runner({
      run: vi.fn(async () => ({ status: 127, stdout: '', stderr: 'ENOENT' })),
    })
    const controller = new OpenClawConnectorController(commands)

    const state = await controller.snapshot()
    expect(state.connectors.every(connector => connector.status === 'missing-runtime')).toBe(true)
  })

  it('rejects unknown connector ids rather than forwarding arbitrary commands', async () => {
    const commands = runner()
    const controller = new OpenClawConnectorController(commands)

    await expect(controller.authorize({ id: 'shell' as never })).rejects.toThrow(/unsupported/i)
    expect(commands.start).not.toHaveBeenCalled()
  })
})
