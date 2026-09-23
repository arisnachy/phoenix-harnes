/**
 * Cheap exact-path metadata probe. Use this before read/glob when candidate
 * paths are already known.
 * @module @phoenix-ai/dsh-tool-fs/status
 */
import type { Context } from '@phoenix-ai/cordis'
import { defineTool } from '@phoenix-ai/dsh-tools'
import { sessionResolveOptions } from './session-cwd.ts'

/**
 * Public fs status max paths value.
 */
export const FS_STATUS_MAX_PATHS = 64

function parseStatusArgs(args: { paths: string[] }): string[] {
  if (!Array.isArray(args.paths) || args.paths.length === 0) {
    throw new Error('paths must contain at least one path')
  }
  if (args.paths.length > FS_STATUS_MAX_PATHS) {
    throw new Error(`paths accepts at most ${FS_STATUS_MAX_PATHS} entries`)
  }
  return args.paths.map((path) => {
    if (typeof path !== 'string' || path.trim().length === 0) {
      throw new Error('every path must be a non-empty string')
    }
    return path
  })
}

/**
 * Register the exact-path metadata probe.
 * @param ctx - The ctx value.
 */
export function applyStatusTool(ctx: Context): void {
  ctx.systemPrompt.section({
    name: 'tool:fs-status',
    order: 99,
    text: 'Use fs_status for exact known paths, especially before creating files. It batches existence/type checks without reading file contents or recursively scanning the workspace. If a requested create target is absent, that precondition is satisfied: proceed to write instead of searching for the same file again.',
  })

  ctx.tools.register(defineTool({
    name: 'fs_status',
    description: `Check up to ${FS_STATUS_MAX_PATHS} exact filesystem paths in one cheap call. Returns existence, type, and size when known; never reads file contents and never recursively searches.`,
    parameters: {
      paths: {
        type: 'array',
        required: true,
        items: { type: 'string' },
        description: 'Exact file or directory paths. Relative paths resolve against the session workspace.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          items: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                path: { type: 'string', required: true },
                exists: { type: 'boolean', required: true },
                type: { type: 'string', enum: ['file', 'directory', 'other'] },
                size: { type: 'number' },
              },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value.items) }],
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const paths = parseStatusArgs(args)
      const items: Array<{ path: string; exists: boolean; type?: 'file' | 'directory' | 'other'; size?: number }> = []
      for (const requestedPath of paths) {
        const target = await ctx.fs.resolve(requestedPath, sessionResolveOptions(exec, requestedPath))
        const info = await ctx.fs.stat(target, exec.signal)
        if (info === undefined) {
          ctx.emit('fs/observed', target, { kind: 'absent' }, exec)
          items.push({ path: target.displayPath, exists: false })
          continue
        }
        ctx.emit('fs/observed', target, { kind: 'present', version: info.version }, exec)
        items.push({
          path: target.displayPath,
          exists: true,
          type: info.type,
          ...info.size === undefined ? {} : { size: info.size },
        })
      }
      return { items }
    },
  }))
}
