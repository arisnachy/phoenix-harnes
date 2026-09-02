import { Context } from '@phoenix-ai/cordis'
import { describe, expect, it } from 'vitest'
import type { SessionId, WorkspaceId, WorkspaceView } from '@phoenix-ai/dsh-api-remotes/client'
import { SessionRuntime } from '../src/client/sessions/service.ts'
import { WorkspaceRuntime } from '../src/client/workspaces/service.ts'
import { FakeApiClient, fakeRemote, ok } from './fake-api.client.ts'

const sid = (id: string): SessionId => id as SessionId
const wid = (id: string): WorkspaceId => id as WorkspaceId

function workspace(id: string, sessionIds: SessionId[] = []): WorkspaceView {
  return {
    workspaceId: wid(id),
    path: `/w/${id}`,
    title: id,
    sessionIds,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

describe('WorkspaceRuntime New Session', () => {
  it('creates and opens a fresh session when the current selection is already the workspace blank', async () => {
    const ctx = new Context()
    const api = new FakeApiClient()
    const sessions = new SessionRuntime(ctx, api, fakeRemote())
    const workspaces = new WorkspaceRuntime(ctx, api, sessions)

    api.onWorkspaceList = () => Promise.resolve(ok({
      items: [workspace('alpha', [sid('s-blank')])] as never[],
    }))
    api.onList = () => Promise.resolve(ok({
      items: [{
        sessionId: sid('s-blank'),
        updatedAt: 1,
        running: false,
        blank: true,
        cwd: '/w/alpha',
      }] as never[],
    }))
    await Promise.all([workspaces.refresh(), sessions.refresh()])
    await Promise.resolve()
    sessions.open(sid('s-blank'))

    api.onCreate = () => Promise.resolve(ok({ sessionId: sid('s-fresh') }))
    workspaces.startSession()
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(api.callsOf('session.create')).toEqual([{ workspaceId: 'alpha' }])
    expect(sessions.list.getSnapshot().current).toBe('s-fresh')
  })
})
