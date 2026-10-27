export interface CoverSearchCandidate {
  coverId: number
  title: string
  authors: string[]
  firstPublishedYear: number | null
  editionCount: number | null
  previewUrl: string
  sourceUrl: string
}
