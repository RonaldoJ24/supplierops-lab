import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadScenarioFixture } from '../../src/shared/fixtures'
import { ImportSourcePacketOutputSchema } from '../../src/shared/schemas'
import { MAX_SOURCE_PACKET_BYTES, MAX_SOURCE_PACKET_FILES } from '../../src/main/constants'
import { WorkspaceStore } from '../../src/main/persistence'
import { ProviderBoundary } from '../../src/main/provider'
import { classifySourceKind, WorkspaceService } from '../../src/main/workspace'

describe('main-owned source packet import', () => {
  const temporaryDirectories: string[] = []
  const stores: WorkspaceStore[] = []

  afterEach(() => {
    for (const store of stores.splice(0)) store.close()
    for (const directory of temporaryDirectories.splice(0))
      rmSync(directory, { recursive: true, force: true })
  })

  function createService(): WorkspaceService {
    const directory = mkdtempSync(join(tmpdir(), 'supplierops-source-import-'))
    temporaryDirectories.push(directory)
    const store = new WorkspaceStore(join(directory, 'workspace.sqlite'))
    store.open()
    stores.push(store)
    const provider = new ProviderBoundary(store, directory, {
      apiKey: '',
      loadFromEnvironment: false,
    })
    return new WorkspaceService(store, provider)
  }

  it('creates one bounded untrusted entry and evidence projection per selected file', async () => {
    const service = createService()
    const fixture = loadScenarioFixture('clean-match')
    const imported = await service.importSourcePacket(
      { caseMetadata: fixture.input.caseMetadata, at: fixture.input.at },
      [
        { fileName: '/private/invoice-100.json', extension: 'json', byteSize: 100, preview: '{}' },
        {
          fileName: '/private/purchase-order-100.csv',
          extension: 'csv',
          byteSize: 200,
          preview: 'sku,description\nSKU-100,Industrial bolt',
        },
        {
          fileName: '/private/contract-100.md',
          extension: 'md',
          byteSize: 300,
          preview: '# Terms',
        },
        {
          fileName: '/private/catalog-100.tsv',
          extension: 'tsv',
          byteSize: 400,
          preview: 'sku\tprice',
        },
      ],
    )

    const workspace = ImportSourcePacketOutputSchema.parse(imported).workspace
    expect(workspace.sourcePacket).toHaveLength(4)
    expect(workspace.sourcePacket.map((entry) => entry.kind)).toEqual([
      'invoice',
      'purchase_order',
      'contract',
      'catalog',
    ])
    expect(workspace.sourcePacket.every((entry) => entry.trustBoundary === 'untrusted')).toBe(true)
    expect(workspace.sourcePacket.every((entry) => entry.evidence.length === 1)).toBe(true)
    expect(
      workspace.sourcePacket.every((entry) =>
        entry.evidence[0]?.locator.includes('non-authoritative'),
      ),
    ).toBe(true)
    expect(JSON.stringify(workspace)).not.toContain('/private/')
    expect(workspace.sourcePacket.map((entry) => entry.name)).toEqual([
      'invoice-100.json',
      'purchase-order-100.csv',
      'contract-100.md',
      'catalog-100.tsv',
    ])
  })

  it('rejects packet count, unsupported extensions, and per-file bounds', async () => {
    const service = createService()
    const fixture = loadScenarioFixture('clean-match')
    const input = { caseMetadata: fixture.input.caseMetadata, at: fixture.input.at }
    const file = { fileName: 'invoice.json', extension: 'json', byteSize: 1, preview: '{}' }

    await expect(
      service.importSourcePacket(
        input,
        Array.from({ length: MAX_SOURCE_PACKET_FILES + 1 }, () => file),
      ),
    ).rejects.toThrow('must contain')
    await expect(
      service.importSourcePacket(input, [{ ...file, extension: 'exe' }]),
    ).rejects.toThrow('unsupported')
    await expect(
      service.importSourcePacket(input, [{ ...file, byteSize: MAX_SOURCE_PACKET_BYTES + 1 }]),
    ).rejects.toThrow('size limit')
  })

  it('uses filename heuristics only as non-authoritative classification', () => {
    expect(classifySourceKind('invoice-1.pdf', 'pdf')).toBe('invoice')
    expect(classifySourceKind('po-1.csv', 'csv')).toBe('purchase_order')
    expect(classifySourceKind('terms.md', 'md')).toBe('contract')
    expect(classifySourceKind('unlabeled.json', 'json')).toBe('other')
  })
})
