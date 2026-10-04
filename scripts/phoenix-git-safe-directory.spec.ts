import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { gitSafeDirectoryEnvironment } from './phoenix-git-safe-directory.mjs'

const repository = join(tmpdir(), 'Phoenix').replaceAll('\\', '/')

describe('PHOENIX Git safe-directory environment', () => {
  it('appends a repository-scoped safe.directory without touching global config', () => {
    const env = gitSafeDirectoryEnvironment({}, [repository])
    expect(env.GIT_CONFIG_COUNT).toBe('1')
    expect(env.GIT_CONFIG_KEY_0).toBe('safe.directory')
    expect(env.GIT_CONFIG_VALUE_0).toBe(repository)
  })

  it('preserves existing command-scope Git config and de-duplicates safe directories', () => {
    const env = gitSafeDirectoryEnvironment({
      GIT_CONFIG_COUNT: '2',
      GIT_CONFIG_KEY_0: 'core.autocrlf',
      GIT_CONFIG_VALUE_0: 'false',
      GIT_CONFIG_KEY_1: 'safe.directory',
      GIT_CONFIG_VALUE_1: repository,
    }, [repository, repository])

    expect(env.GIT_CONFIG_COUNT).toBe('2')
    expect(env.GIT_CONFIG_KEY_0).toBe('core.autocrlf')
    expect(env.GIT_CONFIG_VALUE_0).toBe('false')
    expect(env.GIT_CONFIG_KEY_1).toBe('safe.directory')
    expect(env.GIT_CONFIG_VALUE_1).toBe(repository)
  })
})
