import { describe, expect, it } from 'vitest'
import { ConflictError, PermissionError } from './errors.js'
import { ToolRegistry } from './registry.js'
import type { Tool, ToolContext } from './types.js'

const ctx: ToolContext = {
  requestId: 'test',
  now: () => 0,
  log: () => {},
  dataDir: '.',
}

function tool(name: string, permissions: Tool['permissions'] = []): Tool<{ v: number }, number> {
  return {
    name,
    description: `test tool ${name}`,
    inputSchema: { type: 'object', properties: { v: { type: 'number' } }, required: ['v'] },
    outputSchema: { type: 'number' },
    permissions,
    surface: 'core',
    handler: async (input) => input.v * 2,
  }
}

describe('ToolRegistry', () => {
  it('registers and invokes a tool', async () => {
    const registry = new ToolRegistry().register(tool('double'))
    expect(registry.size).toBe(1)
    expect(registry.names()).toEqual(['double'])
    await expect(registry.invoke('double', { v: 21 }, ctx)).resolves.toBe(42)
  })

  it('rejects a duplicate name and names both sources', () => {
    const registry = new ToolRegistry().register(tool('a'), { source: 'core' })
    expect(() => registry.register(tool('a'), { source: 'plugin:x' })).toThrowError(ConflictError)
    try {
      registry.register(tool('a'), { source: 'plugin:y' })
    } catch (error) {
      const conflict = error as ConflictError
      expect(conflict.details.existingSource).toBe('core')
      expect(conflict.details.incomingSource).toBe('plugin:y')
    }
    expect(registry.size).toBe(1)
  })

  it('refuses a tool whose permissions are not granted, before invoking', async () => {
    const registry = new ToolRegistry().register(tool('writer', ['fs:write']))
    await expect(registry.invoke('writer', { v: 1 }, ctx, ['fs:read'])).rejects.toBeInstanceOf(
      PermissionError,
    )
  })

  it('allows a tool whose permissions are granted', async () => {
    const registry = new ToolRegistry().register(tool('writer', ['fs:write']))
    await expect(registry.invoke('writer', { v: 3 }, ctx, ['fs:write'])).resolves.toBe(6)
  })

  it('refuses a tool that requires a permission when nothing at all was granted', async () => {
    // The granted set is empty, so nothing is granted. A rank ceiling of 0 still admits
    // `fs:read`, the lowest-ranked permission, which silently runs a filesystem-reading
    // tool through the default `invoke` path.
    const registry = new ToolRegistry().register(tool('reader', ['fs:read']))
    await expect(registry.invoke('reader', { v: 1 }, ctx)).rejects.toBeInstanceOf(PermissionError)
  })

  it('refuses a permission that was never granted, however high the granted ceiling ranks', async () => {
    // The regression: `isSatisfied` compared rank ceilings instead of testing membership, so
    // granting proc:spawn (rank 4) also admitted env:read (rank 2) and fs:write (rank 3) —
    // capabilities the caller never granted. Only `secrets:read` was refused.
    const registry = new ToolRegistry()
      .register(tool('reads_env', ['env:read']))
      .register(tool('writes_fs', ['fs:write']))
    const granted = ['fs:read', 'net:fetch', 'proc:spawn']
    await expect(registry.invoke('reads_env', { v: 1 }, ctx, granted)).rejects.toBeInstanceOf(PermissionError)
    await expect(registry.invoke('writes_fs', { v: 1 }, ctx, granted)).rejects.toBeInstanceOf(PermissionError)
  })

  it('allows a tool needing only a subset of the granted permissions', async () => {
    const registry = new ToolRegistry().register(tool('board', ['proc:spawn', 'fs:read']))
    await expect(
      registry.invoke('board', { v: 5 }, ctx, ['fs:read', 'net:fetch', 'proc:spawn']),
    ).resolves.toBe(10)
  })

  it('allows a tool that declares no permissions, granted or not', async () => {
    const registry = new ToolRegistry().register(tool('pure', []))
    await expect(registry.invoke('pure', { v: 4 }, ctx, [])).resolves.toBe(8)
  })

  it('throws for an unknown tool', () => {
    expect(() => new ToolRegistry().get('nope')).toThrowError(ConflictError)
  })

  it('lists tools in a stable sorted order', () => {
    const registry = new ToolRegistry().register(tool('zeta')).register(tool('alpha'))
    expect(registry.names()).toEqual(['alpha', 'zeta'])
  })
})
