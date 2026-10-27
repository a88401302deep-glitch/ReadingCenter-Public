/** Return only same-directory image files whose final numeric suffix differs.
 * These are review candidates, never automatic cover matches.
 */
export function findMoonCoverCandidates(reference: string, availablePaths: Iterable<string>): string[] {
  const referenceMatch = /^(.*?)(?:_(\d+))?(\.(?:png|jpe?g|webp))$/i.exec(reference)
  if (!referenceMatch) return []
  const [, directoryAndBase, , extension] = referenceMatch
  const referenceDirectory = directoryAndBase.slice(0, directoryAndBase.lastIndexOf('/') + 1)
  const referenceBase = directoryAndBase.slice(referenceDirectory.length).toLocaleLowerCase()
  const referenceExtension = extension.toLocaleLowerCase()
  return [...new Set(availablePaths)]
    .filter(path => path !== reference && path !== reference.toLocaleLowerCase())
    .filter(path => {
      const match = /^(.*?)(?:_(\d+))?(\.(?:png|jpe?g|webp))$/i.exec(path)
      if (!match) return false
      const [, directoryAndBase, , candidateExtension] = match
      const directory = directoryAndBase.slice(0, directoryAndBase.lastIndexOf('/') + 1)
      const base = directoryAndBase.slice(directory.length).toLocaleLowerCase()
      return directory === referenceDirectory && base === referenceBase && candidateExtension.toLocaleLowerCase() === referenceExtension
    })
    .sort((a, b) => a.localeCompare(b, 'en'))
    .slice(0, 8)
}
