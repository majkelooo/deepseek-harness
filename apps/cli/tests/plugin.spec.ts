import { describe, expect, it } from 'vitest'
import { withWorkspaceRoot } from '../src/plugin.ts'

// A profile directory is a pnpm workspace root by construction (initProfile writes its
// pnpm-workspace.yaml), so a mutating pnpm command forwarded there needs the explicit
// `-w` pnpm would otherwise demand from the user (ERR_PNPM_ADDING_TO_ROOT, reproduced
// on pnpm 9.15 and 11.7).
describe('withWorkspaceRoot', () => {
  it('appends -w to add and its aliases, not to read-only commands', () => {
    expect(withWorkspaceRoot(['add', '@deepseek-ai/dsh-hooks-claude-code'])).toEqual(['add', '@deepseek-ai/dsh-hooks-claude-code', '-w'])
    expect(withWorkspaceRoot(['remove', 'x'])).toEqual(['remove', 'x', '-w'])
    expect(withWorkspaceRoot(['uninstall', 'x'])).toEqual(['uninstall', 'x', '-w'])
    expect(withWorkspaceRoot(['install'])).toEqual(['install'])
    expect(withWorkspaceRoot(['list', '--depth', '0'])).toEqual(['list', '--depth', '0'])
  })

  it('never duplicates a flag the caller already passed', () => {
    expect(withWorkspaceRoot(['add', 'x', '-w'])).toEqual(['add', 'x', '-w'])
    expect(withWorkspaceRoot(['--workspace-root', 'add', 'x'])).toEqual(['--workspace-root', 'add', 'x'])
  })

  it('treats an all-flags argv as no command', () => {
    expect(withWorkspaceRoot(['--dir', '.'])).toEqual(['--dir', '.'])
    expect(withWorkspaceRoot([])).toEqual([])
  })
})
