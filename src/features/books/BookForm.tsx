import { bookTypeLabels, libraryBookType } from '../library/library-book-summary'
import { useAuth } from '../auth/auth-context'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { getBookDisplayTitle, getBookNotes, getBookSourceUrls, type Book, type BookCover, type BookCollection, type DictionaryEntry } from '../../domain'
import { Button } from '../../shared/ui/Button'
import { FormMessage } from '../../shared/ui/FormMessage'
import { MultiSelect, type MultiSelectOption } from '../../shared/ui/MultiSelect'
import { BookMetadataSearch } from './BookMetadataSearch'
import { BookCoverSearch } from './BookCoverSearch'
import { BookCoverPaste } from './BookCoverPaste'
import { uploadBookCover, validateCoverFile } from './book-cover-upload'
import type { BookDraft } from './book-service'

interface BookFormProps { book?: Book; busy?: boolean; dictionaries?: DictionaryEntry[]; collections?: BookCollection[]; books?: Book[]; categoryRecommendations?: MultiSelectOption[]; tagRecommendations?: MultiSelectOption[]; error?: string | null; onCancel: () => void; onDirtyChange?: (dirty: boolean) => void; onSubmit: (draft: BookDraft) => Promise<void> }

export function BookForm({ book, busy = false, dictionaries = [], collections = [], books = [], categoryRecommendations, tagRecommendations, error, onCancel, onDirtyChange, onSubmit }: BookFormProps) {
  const { previewReadOnly = false } = useAuth()
  const titleInputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { titleInputRef.current?.focus({ preventScroll: true }) }, [])
  useEffect(() => { document.body.classList.add('book-editor-open'); return () => document.body.classList.remove('book-editor-open') }, [])
  const mediaTypeChoices = dictionaries.filter(item => item.kind === 'mediaType')
  const notes = book ? getBookNotes(book) : { bookNote: '' }
  const [sourceUrlsText, setSourceUrlsText] = useState(book ? getBookSourceUrls(book).join('\n') : '')
  const initialAuthors = book?.authorIds.map(id => dictionaries.find(item => item.id === id)?.name).filter(Boolean).join('\n') ?? ''
  const initialPublisher = dictionaries.find(item => item.id === book?.publisherId)?.name ?? ''
  const [authorNamesText, setAuthorNamesText] = useState(initialAuthors)
  const creditNames = (role: 'translator' | 'illustration') => (book?.creatorCredits ?? []).filter(credit => credit.role === role).map(credit => dictionaries.find(entry => entry.id === credit.creatorId)?.name).filter(Boolean).join('\n')
  const initialTranslators = creditNames('translator'), initialIllustrators = creditNames('illustration')
  const [translatorNamesText, setTranslatorNamesText] = useState(initialTranslators)
  const [illustratorNamesText, setIllustratorNamesText] = useState(initialIllustrators)
  const [originalTitle, setOriginalTitle] = useState(book?.originalTitle ?? '')
  const [authorOriginalNamesText, setAuthorOriginalNamesText] = useState(book?.authorOriginalNames?.join('\n') ?? '')
  const [bookForm, setBookForm] = useState<NonNullable<Book['bookForm']>>(book ? libraryBookType(book, dictionaries) ?? 'other' : 'other')
  const [collectionId, setCollectionId] = useState(book?.collectionId ?? '')
  const [newSeriesName, setNewSeriesName] = useState('')
  const [sequenceLabel, setSequenceLabel] = useState(book?.sequence?.label ?? '')
  const [sequenceOrder, setSequenceOrder] = useState(book?.sequence?.sortValue.toString() ?? '')
  const namesFrom = (text: string) => [...new Set(text.split('\n').map(name => name.trim()).filter(Boolean))]
  const [publisherName, setPublisherName] = useState(initialPublisher)
  const [isbn, setIsbn] = useState(book?.isbn ?? '')
  const [publishedOn, setPublishedOn] = useState(book?.publishedOn ?? '')
  const [metadataSourceUrl, setMetadataSourceUrl] = useState('')
  const [title, setTitle] = useState(book?.title ?? '')
  const [preferredTitle] = useState(book?.preferredTitle ?? '')
  const [languageTag] = useState(book?.languageTag ?? 'und')
  const [mediaTypeId, setMediaTypeId] = useState(book?.mediaTypeId ?? 'ebook')
  const [wordCountSourceUrl, setWordCountSourceUrl] = useState<string | null>(book?.wordCountSourceUrl ?? null)
  const [wordCount, setWordCount] = useState(book?.wordCount?.toString() ?? '')
  const [bookNote, setBookNote] = useState(notes.bookNote)
  const [ratingScale, setRatingScale] = useState<5 | 10>(book?.rating?.scale ?? 5)
  const [rating, setRating] = useState(book?.rating?.value?.toString() ?? '')
  const [cover, setCover] = useState<BookCover | null>(book?.cover ?? null)
  const [coverFile, setCoverFile] = useState<File | null>(null)
  const [coverPreview, setCoverPreview] = useState('')
  const [coverError, setCoverError] = useState('')
  const [uploadingCover, setUploadingCover] = useState(false)
  useEffect(() => () => { if (coverPreview) URL.revokeObjectURL(coverPreview) }, [coverPreview])
  const [coverPath, setCoverPath] = useState(book?.cover?.path ?? '')
  const [categoryIds, setCategoryIds] = useState(book?.categoryIds ?? [])
  const [tagIds, setTagIds] = useState(book?.tagIds ?? [])
  useEffect(() => {
    const dirty =
      translatorNamesText !== initialTranslators || illustratorNamesText !== initialIllustrators || originalTitle !== (book?.originalTitle ?? '') || authorOriginalNamesText !== (book?.authorOriginalNames?.join('\n') ?? '') ||
      bookForm !== (book ? libraryBookType(book, dictionaries) ?? 'other' : 'other') || collectionId !== (book?.collectionId ?? '') || Boolean(collectionId === '__new' && newSeriesName) || sequenceLabel !== (book?.sequence?.label ?? '') || sequenceOrder !== (book?.sequence?.sortValue.toString() ?? '') ||
      authorNamesText !== initialAuthors || publisherName !== initialPublisher || isbn !== (book?.isbn ?? '') || publishedOn !== (book?.publishedOn ?? '') || Boolean(metadataSourceUrl) ||
      sourceUrlsText !== (book ? getBookSourceUrls(book).join('\n') : '') ||
      title !== (book?.title ?? '') ||
      preferredTitle !== (book?.preferredTitle ?? '') ||
      languageTag !== (book?.languageTag ?? 'und') ||
      mediaTypeId !== (book?.mediaTypeId ?? 'ebook') ||
      wordCount !== (book?.wordCount?.toString() ?? '') || wordCountSourceUrl !== (book?.wordCountSourceUrl ?? null) ||
      bookNote !== (book ? getBookNotes(book).bookNote : '') ||
      ratingScale !== (book?.rating?.scale ?? 5) ||
      rating !== (book?.rating?.value?.toString() ?? '') ||
      coverFile !== null ||
      coverPath !== (book?.cover?.path ?? '') ||
      categoryIds.join('\u0000') !== (book?.categoryIds ?? []).join('\u0000') ||
      tagIds.join('\u0000') !== (book?.tagIds ?? []).join('\u0000')
    onDirtyChange?.(dirty)
  }, [dictionaries, translatorNamesText, initialTranslators, illustratorNamesText, initialIllustrators, originalTitle, authorOriginalNamesText, bookForm, collectionId, newSeriesName, sequenceLabel, sequenceOrder, authorNamesText, initialAuthors, initialPublisher, publisherName, isbn, publishedOn, metadataSourceUrl, book, bookNote, categoryIds, coverFile, coverPath, languageTag, mediaTypeId, onDirtyChange, preferredTitle, rating, ratingScale, tagIds, title, sourceUrlsText, wordCount, wordCountSourceUrl])

  const options = (kind: 'category' | 'tag') => dictionaries.filter((item) => item.kind === kind).map((item) => ({ id: item.id, label: item.name }))
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy || uploadingCover || previewReadOnly) return
    let savedCover = coverPath.trim() ? (cover?.path === coverPath.trim() ? cover : { path: coverPath.trim(), mimeType: 'image/jpeg' as const }) : null
    if (coverFile && book) {
      setUploadingCover(true); setCoverError('')
      try {
        savedCover = await uploadBookCover({ id: book.id, title }, coverFile)
        setCover(savedCover); setCoverPath(savedCover.path); setCoverFile(null); setCoverPreview('')
      } catch (reason) { setCoverError(reason instanceof Error ? reason.message : '封面上傳失敗'); return }
      finally { setUploadingCover(false) }
    }
    await onSubmit({ wordCountSourceUrl, originalTitle, authorOriginalNames: namesFrom(authorOriginalNamesText), bookForm,
      translatorNames: translatorNamesText === initialTranslators ? undefined : namesFrom(translatorNamesText), illustratorNames: illustratorNamesText === initialIllustrators ? undefined : namesFrom(illustratorNamesText),
      collectionId: collectionId === '__new' ? null : collectionId === (book?.collectionId ?? '') ? undefined : collectionId || null,
      ...(collectionId === '__new' ? { newSeriesName } : {}),
      sequence: sequenceLabel === (book?.sequence?.label ?? '') && sequenceOrder === (book?.sequence?.sortValue.toString() ?? '') ? undefined : sequenceLabel.trim() ? { kind: 'volume', label: sequenceLabel.trim(), sortValue: sequenceOrder.trim() ? Number(sequenceOrder) : 0 } : null,
 authorNames: authorNamesText === initialAuthors ? undefined : [...new Set(authorNamesText.split('\n').map(name => name.trim()).filter(Boolean))], publisherName: publisherName === initialPublisher ? undefined : publisherName, isbn: isbn === (book?.isbn ?? '') ? undefined : isbn, publishedOn: publishedOn === (book?.publishedOn ?? '') ? undefined : publishedOn, metadataSourceUrl: metadataSourceUrl || undefined, wordCount: wordCount.trim() ? Number(wordCount) : null, sourceUrls: [...new Set(sourceUrlsText.split('\n').map((url) => url.trim()).filter(Boolean))], title, preferredTitle, languageTag, mediaTypeId, bookNote, rating: rating ? { value: Number(rating), scale: ratingScale } : null, categoryIds, tagIds, cover: savedCover })
  }
  return <form className="entity-form book-form" onSubmit={submit} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (!busy && !uploadingCover) onCancel() } }}>
    <header className="book-editor-heading"><div><h2>{book ? '編輯書籍' : '新增書籍'}</h2></div><Button aria-label="離開書籍編輯" disabled={busy || uploadingCover} onClick={onCancel}>取消</Button></header>
    <div className="book-form-fields" role="group" aria-label="書籍資料欄位">
    {previewReadOnly && <p role="status">查詢預覽：可核對書籍資料與封面，暫不儲存或上傳。</p>}
    <h3 className="book-form-heading book-form-heading--first">基本資料</h3>
    <div className="book-field"><span className="field-requirement" aria-hidden="true">必填</span><label><span className="field-caption">出版書名</span><input ref={titleInputRef} required aria-label="出版書名" value={title} onChange={(e) => setTitle(e.target.value)} /></label></div>
    <div className="book-field"><span className="field-requirement" aria-hidden="true">完整度必備</span><label><span className="field-caption">作者（每行一位）</span><textarea rows={2} maxLength={4000} value={authorNamesText} onChange={event => setAuthorNamesText(event.target.value)} /></label></div>
    <div className="book-form-grid">
    <div className="book-field"><span className="field-requirement" aria-hidden="true">完整度必備</span><label><span className="field-caption">類型</span><select value={bookForm} onChange={event => setBookForm(event.target.value as NonNullable<Book['bookForm']>)}><option value="other">未設定</option><option value="novel">小說</option><option value="manga">漫畫</option><option value="magazine">雜誌</option><option value="webNovel">網文</option></select></label></div>
    <div className="book-field"><span className="field-requirement" aria-hidden="true">選填</span><label><span className="field-caption">書籍版本</span><select aria-label="書籍版本" value={mediaTypeId} onChange={(e) => setMediaTypeId(e.target.value)}>{!mediaTypeChoices.some(item => item.id === 'ebook') && <option value="ebook">電子書</option>}{mediaTypeChoices.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}{mediaTypeId !== 'ebook' && !mediaTypeChoices.some(item => item.id === mediaTypeId) && <option value={mediaTypeId}>原有格式（未分類）</option>}</select></label></div>
    </div>
    <h3 className="book-form-heading">分類、標籤與評分</h3>
    <MultiSelect kind="category" label="分類" options={options('category')} recommendations={categoryRecommendations} value={categoryIds} onChange={setCategoryIds} />
    <MultiSelect kind="tag" label="標籤" options={options('tag')} recommendations={tagRecommendations} value={tagIds} onChange={setTagIds} />
    <div className="book-form-grid">
    <div className="book-field"><span className="field-requirement" aria-hidden="true">選填</span><label><span className="field-caption">評分刻度</span><select value={ratingScale} onChange={(e) => { setRatingScale(Number(e.target.value) as 5 | 10); setRating('') }}><option value="5">5 分制</option><option value="10">10 分制</option></select></label></div>
    <div className="book-field"><span className="field-requirement" aria-hidden="true">選填</span><label><span className="field-caption">評分</span><select value={rating} onChange={(e) => setRating(e.target.value)}><option value="">未評分</option>{Array.from({ length: ratingScale }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1} 分</option>)}</select></label></div>
    </div>
    <div className="book-field"><span className="field-requirement" aria-hidden="true">選填</span><label><span className="field-caption">書籍備註</span><textarea rows={4} value={bookNote} onChange={(e) => setBookNote(e.target.value)} /></label></div>
    <h3 className="book-form-heading">封面與資料查詢</h3>
    <div className="book-cover-editor">
      {(coverPreview || coverPath) && <img className="book-cover-editor-preview" src={coverPreview || coverPath} alt="封面預覽" />}
      {coverFile && previewReadOnly && <p role="status">封面已選入預覽，尚未上傳。</p>}
      {book ? <div className="book-field"><span className="field-requirement" aria-hidden="true">完整度必備</span><label><span className="field-caption">選擇封面</span><input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy || uploadingCover} onChange={event => {
        const file = event.target.files?.[0]; event.target.value = ''; if (!file) return
        try { validateCoverFile(file); setCoverFile(file); setCoverPreview(URL.createObjectURL(file)); setCoverError('') } catch (reason) { setCoverError(reason instanceof Error ? reason.message : '無效圖片') }
      }} /></label></div> : <p>儲存書籍後可加入封面。</p>}
      {book && <BookCoverPaste disabled={busy || uploadingCover} onSelect={file => { setCoverFile(file); setCoverPreview(URL.createObjectURL(file)); setCoverError('') }} />}
      {book && <BookCoverSearch title={title} author={book.authorIds.map(id => dictionaries.find(item => item.id === id)?.name).filter(Boolean).join(' ')} isbn={book.isbn} disabled={busy || uploadingCover} onSelect={file => { setCoverFile(file); setCoverPreview(URL.createObjectURL(file)); setCoverError('') }} />}
      {(coverFile || coverPath) && <Button disabled={busy || uploadingCover} onClick={() => { setCoverFile(null); setCoverPreview(''); setCover(null); setCoverPath(''); setCoverError('') }}>移除封面</Button>}
      <details><summary>封面路徑</summary><div className="book-field"><span className="field-requirement" aria-hidden="true">選填</span><label><span className="field-caption">封面檔案路徑</span><input placeholder="covers/example.jpg" disabled={busy || uploadingCover} value={coverPath} onChange={(event) => { setCoverPath(event.target.value); setCoverFile(null); setCoverPreview('') }} /></label></div></details>
      {coverError && <FormMessage tone="error">{coverError}</FormMessage>}
    </div>
    <BookMetadataSearch mediaTypeId={mediaTypeId} currentValues={{ bookForm: bookForm === 'other' ? '' : bookTypeLabels[bookForm], title, authors: namesFrom(authorNamesText).join('、'), publisher: publisherName, isbn, publishedOn, originalTitle, authorOriginalNames: namesFrom(authorOriginalNamesText).join('、'), translators: namesFrom(translatorNamesText).join('、'), illustrators: namesFrom(illustratorNamesText).join('、'), wordCount, seriesName: collectionId === '__new' ? newSeriesName : collectionId ? collections.find(item => item.id === collectionId)?.name || '已設定系列' : '', sequenceLabel }} title={title} author={authorNamesText.split('\n')[0]} disabled={busy || uploadingCover} onSelect={(candidate, replace, fields) => {
      if (candidate.bookForm && bookForm !== 'other' && candidate.bookForm !== bookForm && !replace) return
      const versionMatches = replace || !['讀書共和國', '台灣角川'].includes(candidate.source) || mediaTypeId !== 'ebook'
      let applied = false
      if (fields.includes('bookForm') && candidate.bookForm && (replace || bookForm === 'other')) { setBookForm(candidate.bookForm); applied = true }
      if (fields.includes('title') && (replace || !title.trim())) { setTitle(candidate.title); applied = true }
      if (fields.includes('authors') && (replace || !authorNamesText.trim()) && candidate.authors.length) { setAuthorNamesText(candidate.authors.join('\n')); applied = true }
      if (fields.includes('publisher') && (replace || !publisherName.trim()) && candidate.publisher) { setPublisherName(candidate.publisher); applied = true }
      if (fields.includes('isbn') && versionMatches && (replace || !isbn.trim()) && candidate.isbn) { setIsbn(candidate.isbn); applied = true }
      if (fields.includes('publishedOn') && versionMatches && (replace || !publishedOn.trim()) && candidate.publishedOn) { setPublishedOn(candidate.publishedOn); applied = true }
      if (fields.includes('originalTitle') && (replace || !originalTitle.trim()) && candidate.originalTitle) { setOriginalTitle(candidate.originalTitle); applied = true }
      if (fields.includes('authorOriginalNames') && (replace || !authorOriginalNamesText.trim()) && candidate.authorOriginalNames?.length) { setAuthorOriginalNamesText(candidate.authorOriginalNames.join('\n')); applied = true }
      if (fields.includes('translators') && (replace || !translatorNamesText.trim()) && candidate.translators?.length) { setTranslatorNamesText(candidate.translators.join('\n')); applied = true }
      if (fields.includes('illustrators') && (replace || !illustratorNamesText.trim()) && candidate.illustrators?.length) { setIllustratorNamesText(candidate.illustrators.join('\n')); applied = true }
      if (fields.includes('wordCount') && (replace || !wordCount.trim()) && candidate.wordCount) { setWordCount(String(candidate.wordCount)); setWordCountSourceUrl(candidate.sourceUrl); applied = true }
      if (fields.includes('seriesName') && (replace || !collectionId && !newSeriesName.trim()) && candidate.seriesName) { setCollectionId('__new'); setNewSeriesName(candidate.seriesName); applied = true }
      if (fields.includes('sequenceLabel') && (replace || !sequenceLabel.trim()) && candidate.sequenceLabel) { setSequenceLabel(candidate.sequenceLabel); setSequenceOrder(''); applied = true }
      if (applied) setMetadataSourceUrl(candidate.sourceUrl)
    }} onCover={book ? file => { setCoverFile(file); setCoverPreview(URL.createObjectURL(file)); setCoverError('') } : undefined} />
    <h3 className="book-form-heading">出版資訊</h3>
    <div className="book-field"><span className="field-requirement" aria-hidden="true">完整度必備</span><label><span className="field-caption">出版社</span><input maxLength={200} value={publisherName} onChange={event => setPublisherName(event.target.value)} /></label></div>
    <div className="book-field"><span className="field-requirement" aria-hidden="true">選填</span><label><span className="field-caption">ISBN</span><input maxLength={40} value={isbn} onChange={event => setIsbn(event.target.value)} /></label></div>
    <div className="book-field"><span className="field-requirement" aria-hidden="true">選填</span><label><span className="field-caption">出版日期或年份</span><input maxLength={80} value={publishedOn} onChange={event => setPublishedOn(event.target.value)} /></label></div>
    <details className="book-form-extra"><summary>原文書名、譯者與繪者</summary>
    <div className="book-field"><span className="field-requirement" aria-hidden="true">選填</span><label><span className="field-caption">原文書名</span><input maxLength={500} value={originalTitle} onChange={event => setOriginalTitle(event.target.value)} /></label></div>
    <div className="book-field"><span className="field-requirement" aria-hidden="true">選填</span><label><span className="field-caption">作者原名（每行一位）</span><textarea rows={2} maxLength={4000} value={authorOriginalNamesText} onChange={event => setAuthorOriginalNamesText(event.target.value)} /></label></div>
    <div className="book-field"><span className="field-requirement" aria-hidden="true">選填</span><label><span className="field-caption">譯者（每行一位）</span><textarea rows={2} maxLength={4000} value={translatorNamesText} onChange={event => setTranslatorNamesText(event.target.value)} /></label></div>
    <div className="book-field"><span className="field-requirement" aria-hidden="true">選填</span><label><span className="field-caption">繪者／插畫者（每行一位）</span><textarea rows={2} maxLength={4000} value={illustratorNamesText} onChange={event => setIllustratorNamesText(event.target.value)} /></label></div>
    </details>
    <h3 className="book-form-heading">作品與系列</h3>
    <div className="book-form-grid">
    <div className="book-field"><span className="field-requirement" aria-hidden="true">選填</span><label><span className="field-caption">系列名稱</span><select value={collectionId} onChange={event => { setCollectionId(event.target.value); if (!event.target.value) { setSequenceLabel(''); setSequenceOrder('') } }}><option value="">未設定</option>{book?.collectionId && !collections.some(item => item.id === book.collectionId) && <option value={book.collectionId}>保留目前系列（資料未載入）</option>}{collections.filter(item => item.kind === 'series' || item.id === book?.collectionId).map(item => <option key={item.id} value={item.id}>{item.name} · {books.filter(member => member.collectionId === item.id).slice(0, 2).map(member => `${member.bookForm === 'manga' || member.mediaTypeId === 'manga' ? '漫畫' : member.bookForm === 'novel' ? '小說' : '書籍'}：${getBookDisplayTitle(member)}`).join('、') || '尚無書籍'}</option>)}<option value="__new">新增系列…</option></select></label></div>
    {collectionId === '__new' && <div className="book-field"><span className="field-requirement" aria-hidden="true">必填</span><label><span className="field-caption">新系列名稱</span><input required maxLength={200} value={newSeriesName} onChange={event => setNewSeriesName(event.target.value)} /></label></div>}
    <div className="book-field"><span className="field-requirement" aria-hidden="true">選填</span><label><span className="field-caption">卷次／集數</span><input maxLength={100} value={sequenceLabel} onChange={event => setSequenceLabel(event.target.value)} placeholder="例如：第 1 集、外傳" /></label></div>
    <div className="book-field"><span className="field-requirement" aria-hidden="true">選填</span><label><span className="field-caption">卷次排序（選填）</span><input type="number" min="0" step="any" value={sequenceOrder} onChange={event => setSequenceOrder(event.target.value)} /></label></div>
    </div>
    <div className="book-field"><span className="field-requirement" aria-hidden="true">選填</span><label><span className="field-caption">書籍網址（每行一個）</span><textarea rows={2} value={sourceUrlsText} onChange={(e) => setSourceUrlsText(e.target.value)} /></label></div>
    <div className="book-field"><span className="field-requirement" aria-hidden="true">選填</span><label><span className="field-caption">書籍字數</span><input type="number" inputMode="numeric" min="1" step="1" max={Number.MAX_SAFE_INTEGER} placeholder="未知請留白" value={wordCount} onChange={event => { setWordCount(event.target.value); setWordCountSourceUrl(null) }} /></label></div>
    {wordCountSourceUrl && <p><a href={wordCountSourceUrl} target="_blank" rel="noopener noreferrer">核對字數來源</a></p>}
    <p>填書籍標示或文字檔的總字數；閱讀筆記字數另計。</p>
    </div>
    <div className="book-form-footer">
    {error && <FormMessage tone="error">{error}</FormMessage>}
    <div className="form-actions"><Button disabled={busy || uploadingCover} onClick={onCancel}>取消</Button><Button disabled={busy || uploadingCover || previewReadOnly} type="submit" variant="primary">{previewReadOnly ? '此預覽不儲存' : uploadingCover ? '上傳封面中' : busy ? '儲存中' : '儲存'}</Button></div>
    </div>
  </form>
}


