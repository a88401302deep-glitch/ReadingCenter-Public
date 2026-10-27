import { describe, expect, it } from 'vitest'
import { selectLatestMoonBackups } from '../../worker/onedrive-moon-backup-sync'
import type { MoonBackupDriveFile } from '../../worker/onedrive-moon-backup-source'

function file(deviceFolder: string, name: string, lastModifiedDateTime: string | null): MoonBackupDriveFile {
  return { driveItemId: name, deviceFolder, name, eTag: name, size: 100, lastModifiedDateTime }
}

describe('selectLatestMoonBackups', () => {
  it('selects one newest full snapshot from each device folder', () => {
    const selected = selectLatestMoonBackups([
      file('BOOX TUCP', 'old.mrpro', '2026-10-01T00:00:00.000Z'),
      file('BOOX PALMA2', 'only.mrpro', null),
      file('BOOX TUCP', 'new.mrpro', '2026-10-08T00:00:00.000Z'),
      file('BIGME B7PRO', 'newest.mrpro', '2026-10-09T00:00:00.000Z')
    ])

    expect(selected.map(item => [item.deviceFolder, item.name])).toEqual([
      ['BIGME B7PRO', 'newest.mrpro'],
      ['BOOX PALMA2', 'only.mrpro'],
      ['BOOX TUCP', 'new.mrpro']
    ])
  })

  it('fails safely when multiple files cannot be ordered or share the newest timestamp', () => {
    expect(() => selectLatestMoonBackups([
      file('BOOX TUCP', 'one.mrpro', null),
      file('BOOX TUCP', 'two.mrpro', '2026-10-08T00:00:00.000Z')
    ])).toThrow(/Cannot safely choose/)

    expect(() => selectLatestMoonBackups([
      file('BOOX TUCP', 'one.mrpro', '2026-10-08T00:00:00.000Z'),
      file('BOOX TUCP', 'two.mrpro', '2026-10-08T00:00:00.000Z')
    ])).toThrow(/More than one latest/)
  })
})
