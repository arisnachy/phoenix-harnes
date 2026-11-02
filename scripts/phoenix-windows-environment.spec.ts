import { describe, expect, it } from 'vitest'
import { hydratePhoenixEnvironment, readWindowsUserEnvironment } from './phoenix-windows-environment.mjs'

describe('PHOENIX Windows environment hydration', () => {
  it('hydrates a missing Google token from the user environment without replacing explicit process values', () => {
    const reads: string[] = []
    const result = hydratePhoenixEnvironment({ EXISTING: 'process-value' }, {
      platform: 'win32',
      readUserValue: (name) => {
        reads.push(name)
        return name === 'GOOGLE_OAUTH_ACCESS_TOKEN' ? 'user-token' : undefined
      },
    })

    expect(result).toEqual({ EXISTING: 'process-value', GOOGLE_OAUTH_ACCESS_TOKEN: 'user-token' })
    expect(reads).toEqual(['GOOGLE_OAUTH_ACCESS_TOKEN'])
  })

  it('parses only the requested value from reg.exe output and returns no diagnostics containing it', () => {
    const result = readWindowsUserEnvironment('GOOGLE_OAUTH_ACCESS_TOKEN', {
      platform: 'win32',
      run: () => ({
        status: 0,
        stdout: [
          'HKEY_CURRENT_USER\\Environment',
          '    OTHER_VALUE    REG_SZ    ignored',
          '    GOOGLE_OAUTH_ACCESS_TOKEN    REG_SZ    user-token',
        ].join('\r\n'),
      }),
    })

    expect(result).toBe('user-token')
  })
})
