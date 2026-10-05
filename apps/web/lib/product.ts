/**
 * The product's identity and shipped-surface manifest, in one typed place.
 *
 * Both the web UI and the health endpoint read from here, so a value is never stated twice.
 * Per TENETS #15, no count is restated in prose anywhere: the surfaces list is the data, and
 * prose points at it.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export interface Surface {
  readonly id: string
  readonly title: string
  readonly summary: string
  readonly status: 'shipped' | 'omitted'
  /** Required when status is "omitted" — an unexplained omission is a gap, not a decision. */
  readonly reason?: string
}

export const PRODUCT = {
  name: 'Dignity Index Gate',
  slug: 'dignityindex-gate',
  version: '0.1.0',
  tagline:
    'Turn a declared AI deployment into a release verdict, and name the exact transition that blocked it.',
} as const

/**
 * The version comes from the package manifest, never from a constant restated here — two
 * copies of a version is one merge conflict waiting to happen. Falls back to the compiled-in
 * value if the manifest is unreadable (e.g. a bundler that does not inline it).
 */
function manifestVersion(): string {
  try {
    const raw = readFileSync(join(process.cwd(), 'package.json'), 'utf8')
    const parsed = JSON.parse(raw) as { version?: string }
    return parsed.version ?? PRODUCT.version
  } catch {
    return PRODUCT.version
  }
}

export function resolveVersion(): string {
  return manifestVersion()
}

export const SURFACES: readonly Surface[] = [
  {
    id: 'cli',
    title: 'CLI',
    summary: 'The load-bearing entry point. Every capability is reachable without a browser.',
    status: 'shipped',
  },
  {
    id: 'web',
    title: 'Review board',
    summary: 'This app. Server-rendered, keyboard-navigable, rendering the engine’s own committed output.',
    status: 'shipped',
  },
  {
    id: 'mcp-server',
    title: 'MCP server',
    summary: 'Exposes the same tools to any MCP client, so the product is a provider for other agents.',
    status: 'shipped',
  },
  {
    id: 'mcp-client',
    title: 'MCP client',
    summary: 'Connects to configured servers and lists their tools.',
    status: 'shipped',
  },
  {
    id: 'engine',
    title: 'Deterministic engine',
    summary:
      'Pure Python over stdin/stdout. The transition table and the dignity index are code, not a model call.',
    status: 'shipped',
  },
  {
    id: 'memory',
    title: 'Adjudication ledger',
    summary: 'SQLite with WAL, numbered migrations, and an append-only events table.',
    status: 'shipped',
  },
  {
    id: 'skills',
    title: 'Skills catalog',
    summary: 'Markdown skills loaded from disk with frontmatter validation and version gating.',
    status: 'shipped',
  },
  {
    id: 'plugins',
    title: 'Plugin registry',
    summary: 'Manifest-driven extensions with priority-based conflict resolution.',
    status: 'shipped',
  },
  {
    id: 'channels',
    title: 'Channels',
    summary: 'One Channel interface with a local adapter and a doctor probe.',
    status: 'shipped',
  },
  {
    id: 'desktop',
    title: 'Desktop shell',
    summary: 'Not shipped.',
    status: 'omitted',
    reason:
      'The board is a review surface three people share. A local shell would add a binary to ship and no capability that the web board or the CLI does not already provide.',
  },
  {
    id: 'providers',
    title: 'Model providers',
    summary: 'Not shipped.',
    status: 'omitted',
    reason:
      'A provider on this path would only launder a verdict past the deterministic engine. The parts of the job a model should do — drafting the memo, explaining a refusal — are additive and would ship behind the same waist.',
  },
]

export const OMITTED_SURFACES: readonly Surface[] = SURFACES.filter((surface) => surface.status === 'omitted')
