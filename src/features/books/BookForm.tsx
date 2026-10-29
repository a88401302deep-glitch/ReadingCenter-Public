import { metadataFields } from '../../domain/book-metadata'
import { bookTypeLabels, libraryBookType } from '../library/library-book-summary'
import { useAuth } from '../auth/auth-context'
import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import { getBookDisplayTitle, getBookNotes, getBookSourceUrls, type Book, type BookCover, type BookCollection, type DictionaryEntry } from '../../domain'
import { Button } from '../../shared/ui/Button'
import { FormMessage } from '../../shared/ui/FormMessage'
import { MultiSelect, type MultiSelectOption } from '../../shared/ui/MultiSelect'
import { BookMetadataDialog } from './BookMetadataDialog'
import { BookMetadataSearch } from './BookMetadataSearch'
import { BookCoverSearch } from './BookCoverSearch'
import { BookCoverPaste } from './BookCoverPaste'
import { uploadBookCover, validateCoverFile } from './book-cover-upload'
import type { BookDraft } from './book-service'
import { bookTermOptions } from './book-term-catalog'
import { PublisherField } from './PublisherField'
import { BookCreditField } from './BookCreditField'

export type BookEditScope = 'all' | 'bibliography' | 'personal' | 'rating'

interface BookFormProps { expanded?: boolean; inlineMetadataSearch?: boolean; scope?: BookEditScope; restoreView?: { scrollTop: number; openDetails: string[] }; saveNotice?: string; book?: Book; busy?: boolean; dictionaries?: DictionaryEntry[]; collections?: BookCollection[]; books?: Book[]; categoryRecommendations?: MultiSelectOption[]; tagRecommendations?: MultiSelectOption[]; error?: string | null; onCancel: () => void; onDirtyChange?: (dirty: boolean) => void; onSubmit: (draft: BookDraft) => Promise<void> }

export function BookForm({ expanded = false, inlineMetadataSearch = false, scope = 'all', restoreView, saveNotice, book, busy = false, dictionaries = [], collections = [], books = [], categoryRecommendations, tagRecommendations, error, onCancel, onDirtyChange, onSubmit }: BookFormProps) {
  const ExtraFields = expanded ? 'section' : 'details'
  const ExtraHeading = expanded ? 'h4' : 'summary'
  const { previewReadOnly = false } = useAuth()
  const bibliography = scope === 'all' || scope === 'bibliography'
  const personal = scope === 'all' || scope === 'personal'
  const titleInputRef = useRef<HTMLInputElement>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const fieldsRef = useRef<HTMLFieldSetElement>(null)
  const savePending = useRef(false)
  const restored = useRef(false)
  const [submitting, setSubmitting] = useState(false)
  const [metadataBusy, setMetadataBusy] = useState(false)
  useEffect(() => { if (restoreView === undefined) titleInputRef.current?.focus({ preventScroll: true }) }, [restoreView])
  useLayoutEffect(() => {
    if (!restoreView || busy || restored.current) return
    restored.current = true
    if (fieldsRef.current) {
      fieldsRef.current.querySelectorAll('details').forEach(details => {
        details.open = restoreView.openDetails.includes(details.querySelector('summary')?.textContent ?? '')
      })
      fieldsRef.current.scrollTop = restoreView.scrollTop
    }
    formRef.current?.querySelector<HTMLButtonElement>('button[type="submit"]')?.focus({ preventScroll: true })
  }, [restoreView, busy])
  useEffect(() => { document.body.classList.add('book-editor-open'); return () => document.body.classList.remove('book-editor-open') }, [])
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
  const mediaTypeId = book?.mediaTypeId ?? 'ebook'
  const [wordCountSourceUrl, setWordCountSourceUrl] = useState<string | null>(book?.wordCountSourceUrl ?? null)
  const [wordCount, setWordCount] = useState(book?.wordCount?.toString() ?? '')
  const [bookNote, setBookNote] = useState(notes.bookNote)
  const [ratingScale, setRatingScale] = useState<5 | 10>(book?.rating?.scale ?? 5)
  const [rating, setRating] = useState(book?.rating?.value?.toString() ?? '')
  const [coverBookId] = useState(() => book?.id ?? crypto.randomUUID())
  const [coverSearchOpen, setCoverSearchOpen] = useState(false)
  const [coverSize, setCoverSize] = useState<{ src: string; width: number; height: number } | null>(null)
  const [cover, setCover] = useState<BookCover | null>(book?.cover ?? null)
  const [coverFile, setCoverFile] = useState<File | null>(null)
  const [coverPreview, setCoverPreview] = useState('')
  const [coverError, setCoverError] = useState('')
  const [uploadingCover, setUploadingCover] = useState(false)
  useEffect(() => () => { if (coverPreview) URL.revokeObjectURL(coverPreview) }, [coverPreview])
  const [coverPath, setCoverPath] = useState(book?.cover?.path ?? '')
  const [categoryIds, setCategoryIds] = useState(book?.categoryIds ?? [])
  const [sourceIds, setSourceIds] = useState(book?.sourceIds ?? [])
  const [tagIds, setTagIds] = useState(book?.tagIds ?? [])
  useLayoutEffect(() => {
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
      sourceIds.join('\u0000') !== (book?.sourceIds ?? []).join('\u0000') ||
      tagIds.join('\u0000') !== (book?.tagIds ?? []).join('\u0000')
    onDirtyChange?.(dirty)
  }, [dictionaries, translatorNamesText, initialTranslators, illustratorNamesText, initialIllustrators, originalTitle, authorOriginalNamesText, bookForm, collectionId, newSeriesName, sequenceLabel, sequenceOrder, authorNamesText, initialAuthors, initialPublisher, publisherName, isbn, publishedOn, metadataSourceUrl, book, bookNote, categoryIds, coverFile, coverPath, languageTag, mediaTypeId, onDirtyChange, preferredTitle, rating, ratingScale, sourceIds, tagIds, title, sourceUrlsText, wordCount, wordCountSourceUrl])

  const options = (kind: 'category' | 'tag' | 'source') => dictionaries.filter((item) => item.kind === kind).map((item) => ({ id: item.id, label: item.name }))
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy || uploadingCover || previewReadOnly || savePending.current) return
    savePending.current = true
    setSubmitting(true)
    try {
    let savedCover = coverPath.trim() ? (cover?.path === coverPath.trim() ? cover : { path: coverPath.trim(), mimeType: 'image/jpeg' as const }) : null
    if (coverFile) {
      setUploadingCover(true); setCoverError('')
      try {
        savedCover = await uploadBookCover({ id: coverBookId, title }, coverFile)
        setCover(savedCover); setCoverPath(savedCover.path); setCoverFile(null); setCoverPreview('')
      } catch (reason) { setCoverError(reason instanceof Error ? reason.message : '封面上傳失敗'); return }
      finally { setUploadingCover(false) }
    }
    const draft: BookDraft = { ...(!book ? { reservedId: coverBookId } : {}), wordCountSourceUrl, originalTitle, authorOriginalNames: namesFrom(authorOriginalNamesText), bookForm,
      translatorNames: translatorNamesText === initialTranslators ? undefined : namesFrom(translatorNamesText), illustratorNames: illustratorNamesText === initialIllustrators ? undefined : namesFrom(illustratorNamesText),
      collectionId: collectionId === '__new' ? null : collectionId === (book?.collectionId ?? '') ? undefined : collectionId || null,
      ...(collectionId === '__new' ? { newSeriesName } : {}),
      sequence: sequenceLabel === (book?.sequence?.label ?? '') && sequenceOrder === (book?.sequence?.sortValue.toString() ?? '') ? undefined : sequenceLabel.trim() ? { kind: 'volume', label: sequenceLabel.trim(), sortValue: sequenceOrder.trim() ? Number(sequenceOrder) : 0 } : null,
 authorNames: authorNamesText === initialAuthors ? undefined : [...new Set(authorNamesText.split('\n').map(name => name.trim()).filter(Boolean))], publisherName: publisherName === initialPublisher ? undefined : publisherName, isbn: isbn === (book?.isbn ?? '') ? undefined : isbn, publishedOn: publishedOn === (book?.publishedOn ?? '') ? undefined : publishedOn, metadataSourceUrl: metadataSourceUrl || undefined, wordCount: wordCount.trim() ? Number(wordCount) : null, sourceUrls: [...new Set(sourceUrlsText.split('\n').map((url) => url.trim()).filter(Boolean))], title, preferredTitle, languageTag, mediaTypeId, bookNote, rating: rating ? { value: Number(rating), scale: ratingScale } : null, categoryIds, tagIds, sourceIds, cover: savedCover }
    await onSubmit(scope === 'rating' && book ? {
      title: book.title, preferredTitle: book.preferredTitle, mediaTypeId: book.mediaTypeId, cover: book.cover, rating: draft.rating,
    } : scope === 'personal' && book ? {
      title: book.title, preferredTitle: book.preferredTitle, mediaTypeId: book.mediaTypeId, cover: book.cover,
      bookForm, sourceIds, tagIds, sourceUrls: draft.sourceUrls,
    } : scope === 'bibliography' ? {
      ...draft, bookForm: undefined, sourceIds: undefined, tagIds: undefined, rating: undefined, sourceUrls: undefined,
    } : draft)
    } finally { savePending.current = false; setSubmitting(false) }
  }
  return <form ref={formRef} className={`entity-form book-form${expanded ? ' book-form--expanded' : ''}`} onSubmit={submit} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (!busy && !submitting && !uploadingCover) onCancel() } }}>
    <header className="book-editor-heading"><div><h2>{scope === 'rating' ? '編輯評分' : scope === 'personal' ? '編輯我的分類與標籤' : book ? '編輯書籍' : '新增書籍'}</h2></div><Button aria-label="離開書籍編輯" disabled={busy || submitting || uploadingCover} onClick={onCancel}>{saveNotice ? '完成' : '取消'}</Button></header>
    <fieldset ref={fieldsRef} className="book-form-fields" aria-label={scope === 'rating' ? '評分欄位' : scope === 'personal' ? '我的分類與標籤欄位' : '書籍資料欄位'} disabled={busy || submitting || uploadingCover}>
    {previewReadOnly && <p role="status">查詢預覽：可核對書籍資料與封面，暫不儲存或上傳。</p>}
    {bibliography && <>
    <BookMetadataDialog inline={inlineMetadataSearch} disabled={busy || submitting || uploadingCover || metadataBusy}><BookMetadataSearch supportedFields={scope === 'bibliography' ? metadataFields.filter(field => field !== 'bookForm') : undefined} embeddedInDialog onBusyChange={setMetadataBusy} mediaTypeId={mediaTypeId} currentValues={{ bookForm: bookForm === 'other' ? '' : bookTypeLabels[bookForm], title, authors: namesFrom(authorNamesText).join('、'), publisher: publisherName, isbn, publishedOn, originalTitle, authorOriginalNames: namesFrom(authorOriginalNamesText).join('、'), translators: namesFrom(translatorNamesText).join('、'), illustrators: namesFrom(illustratorNamesText).join('、'), wordCount, seriesName: collectionId === '__new' ? newSeriesName : collectionId ? collections.find(item => item.id === collectionId)?.name || '已設定系列' : '', sequenceLabel }} title={title} author={authorNamesText.split('\n')[0]} disabled={busy || submitting || uploadingCover} onSelect={(candidate, replace, fields) => {
      if (candidate.bookForm && bookForm !== 'other' && candidate.bookForm !== bookForm && !replace) return
      const versionMatches = replace || !['讀書共和國', '台灣角川'].includes(candidate.source) || mediaTypeId !== 'ebook'
      let applied = false
      if (scope === 'all' && fields.includes('bookForm') && candidate.bookForm && (replace || bookForm === 'other')) { setBookForm(candidate.bookForm); applied = true }
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
    }} onCover={scope === 'all' ? file => { setCoverFile(file); setCoverPreview(URL.createObjectURL(file)); setCoverError('') } : undefined} /></BookMetadataDialog>
    <h3 className="book-form-heading book-form-heading--first">基本資料</h3>
    <div className="book-field"><span className="field-requirement" aria-hidden="true">必填</span><label><span className="field-caption">出版書名</span><input ref={titleInputRef} required aria-label="出版書名" value={title} onChange={(e) => setTitle(e.target.value)} /></label></div>
    <div className="book-field"><span className="field-requirement" aria-hidden="true">完整度必備</span><label><span className="field-caption">作者（每行一位）</span><textarea rows={2} maxLength={4000} value={authorNamesText} onChange={event => setAuthorNamesText(event.target.value)} /></label></div>
    <MultiSelect kind="category" label="分類" chooseFromList options={bookTermOptions('category', dictionaries)} recommendations={categoryRecommendations} value={categoryIds} onChange={setCategoryIds} />
    <p className="book-term-help">分類是書的主題，可複選或留空；選單參考讀墨分類整理。</p>
    <h3 className="book-form-heading">出版資訊</h3>
    <PublisherField entries={dictionaries} value={publisherName} onChange={setPublisherName} />
    <div className="book-field"><span className="field-requirement" aria-hidden="true">選填</span><label><span className="field-caption">ISBN</span><input maxLength={40} value={isbn} onChange={event => setIsbn(event.target.value)} /></label></div>
    <div className="book-field"><span className="field-requirement" aria-hidden="true">選填</span><label><span className="field-caption">出版日期或年份</span><input maxLength={80} value={publishedOn} onChange={event => setPublishedOn(event.target.value)} /></label></div>
    <ExtraFields className="book-form-extra"><ExtraHeading>原文書名、譯者與繪者</ExtraHeading>
    <div className="book-field"><span className="field-requirement" aria-hidden="true">選填</span><label><span className="field-caption">原文書名</span><input maxLength={500} value={originalTitle} onChange={event => setOriginalTitle(event.target.value)} /></label></div>
    <BookCreditField label="作者原名（每行一位）" value={authorOriginalNamesText} onChange={setAuthorOriginalNamesText} />
    <BookCreditField label="譯者（每行一位）" value={translatorNamesText} onChange={setTranslatorNamesText} />
    <BookCreditField label="繪者／插畫者（每行一位）" value={illustratorNamesText} onChange={setIllustratorNamesText} />
    </ExtraFields>
    <h3 className="book-form-heading">作品與系列</h3>
    <div className="book-form-grid">
    <div className="book-field"><span className="field-requirement" aria-hidden="true">選填</span><label><span className="field-caption">系列名稱</span><select value={collectionId} onChange={event => { setCollectionId(event.target.value); if (!event.target.value) { setSequenceLabel(''); setSequenceOrder('') } }}><option value="">未設定</option>{book?.collectionId && !collections.some(item => item.id === book.collectionId) && <option value={book.collectionId}>保留目前系列（資料未載入）</option>}{collections.filter(item => item.kind === 'series' || item.id === book?.collectionId).map(item => <option key={item.id} value={item.id}>{item.name} · {books.filter(member => member.collectionId === item.id).slice(0, 2).map(member => `${member.bookForm === 'manga' || member.mediaTypeId === 'manga' ? '漫畫' : member.bookForm === 'novel' ? '小說' : '書籍'}：${getBookDisplayTitle(member)}`).join('、') || '尚無書籍'}</option>)}<option value="__new">新增系列…</option></select></label></div>
    {collectionId === '__new' && <div className="book-field"><span className="field-requirement" aria-hidden="true">必填</span><label><span className="field-caption">新系列名稱</span><input required maxLength={200} value={newSeriesName} onChange={event => setNewSeriesName(event.target.value)} /></label></div>}
    <div className="book-field"><span className="field-requirement" aria-hidden="true">選填</span><label><span className="field-caption">卷次／集數</span><input maxLength={100} value={sequenceLabel} onChange={event => setSequenceLabel(event.target.value)} placeholder="例如：第 1 集、外傳" /></label></div>
    <div className="book-field"><span className="field-requirement" aria-hidden="true">選填</span><label><span className="field-caption">卷次排序（選填）</span><input type="number" min="0" step="any" value={sequenceOrder} onChange={event => setSequenceOrder(event.target.value)} /></label></div>
    </div>
    <div className="book-field"><span className="field-requirement" aria-hidden="true">選填</span><label><span className="field-caption">書籍字數</span><input type="number" inputMode="numeric" min="1" step="1" max={Number.MAX_SAFE_INTEGER} placeholder="未知請留白" value={wordCount} onChange={event => { setWordCount(event.target.value); setWordCountSourceUrl(null) }} /></label></div>
    {wordCountSourceUrl && <p><a href={wordCountSourceUrl} target="_blank" rel="noopener noreferrer">核對字數來源</a></p>}
    <p>填書籍標示或文字檔的總字數；閱讀筆記字數另計。</p>
    <div className="book-field"><span className="field-requirement" aria-hidden="true">選填</span><label><span className="field-caption">書籍備註</span><textarea rows={4} value={bookNote} onChange={(e) => setBookNote(e.target.value)} /></label></div>
    </>}
    {personal && <>
    <h3 className="book-form-heading">我的分類與標籤</h3>
    <div className="book-field"><span className="field-requirement" aria-hidden="true">完整度必備</span><label><span className="field-caption">類型</span><select value={bookForm} onChange={event => setBookForm(event.target.value as NonNullable<Book['bookForm']>)}><option value="other">{scope === 'all' ? '未設定' : '一般書籍'}</option><option value="novel">小說</option><option value="manga">漫畫</option><option value="magazine">雜誌</option><option value="webNovel">網文</option></select></label></div>
    <p className="book-term-help">類型指作品形式：小說、漫畫、雜誌或網文；推理、奇幻等細分題材請選標籤。</p>
    <MultiSelect kind="source" label="書籍來源" options={[...options('source'), ...sourceIds.filter(id => !dictionaries.some(item => item.id === id && item.kind === 'source')).map(id => ({ id, label: '原有來源' }))]} value={sourceIds} onChange={setSourceIds} />
    <MultiSelect kind="tag" label="標籤" chooseFromList options={bookTermOptions('tag', dictionaries)} recommendations={tagRecommendations} value={tagIds} onChange={setTagIds} />
    <p className="book-term-help">標籤是細分題材，例如推理、異世界、成長；可複選或留空。常用項目依你的書庫使用次數排列。</p>
    <div className="book-field"><span className="field-requirement" aria-hidden="true">選填</span><label><span className="field-caption">書籍網址（每行一個）</span><textarea rows={2} value={sourceUrlsText} onChange={(e) => setSourceUrlsText(e.target.value)} /></label></div>
    </>}
    {(scope === 'all' || scope === 'rating') && <>
    <h3 className="book-form-heading">評分</h3>
    <div className="book-form-grid">
    <div className="book-field"><span className="field-requirement" aria-hidden="true">選填</span><label><span className="field-caption">評分刻度</span><select value={ratingScale} onChange={(e) => { setRatingScale(Number(e.target.value) as 5 | 10); setRating('') }}><option value="5">5 分制</option><option value="10">10 分制</option></select></label></div>
    <div className="book-field"><span className="field-requirement" aria-hidden="true">選填</span><label><span className="field-caption">評分</span><select value={rating} onChange={(e) => setRating(e.target.value)}><option value="">未評分</option>{Array.from({ length: ratingScale }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1} 分</option>)}</select></label></div>
    </div>
    </>}
    {scope === 'all' && <>
    <h3 className="book-form-heading">封面與資料查詢</h3>
    <div className="book-cover-editor">
      {(coverPreview || coverPath) && <img key={coverPreview || coverPath} className="book-cover-editor-preview" src={coverPreview || coverPath} alt="封面預覽" onLoad={event => setCoverSize({ src: coverPreview || coverPath, width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} />}
      {coverSize?.src === (coverPreview || coverPath) && <p role="status">目前封面：{coverSize.width} × {coverSize.height} 像素{coverSize.width < 400 ? '（小圖，放大可能模糊）' : ''}{coverFile ? '，尚未儲存' : ''}</p>}
      <Button disabled={busy || uploadingCover} onClick={() => setCoverSearchOpen(true)}>選擇封面／重新找封面</Button>
      {coverFile && previewReadOnly && <p role="status">封面已選入預覽，尚未上傳。</p>}
      <div className="book-field"><span className="field-requirement" aria-hidden="true">完整度必備</span><label><span className="field-caption">選擇封面</span><input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy || uploadingCover} onChange={event => {
        const file = event.target.files?.[0]; event.target.value = ''; if (!file) return
        try { validateCoverFile(file); setCoverFile(file); setCoverPreview(URL.createObjectURL(file)); setCoverError('') } catch (reason) { setCoverError(reason instanceof Error ? reason.message : '無效圖片') }
      }} /></label></div>
      <BookCoverPaste disabled={busy || uploadingCover} onSelect={file => { setCoverFile(file); setCoverPreview(URL.createObjectURL(file)); setCoverError('') }} />
      <BookCoverSearch key={coverSearchOpen ? 'open' : 'closed'} title={title} author={authorNamesText.replaceAll('\n', ' ')} isbn={isbn || null} open={coverSearchOpen} onOpenChange={setCoverSearchOpen} disabled={busy || uploadingCover} onSelect={file => { setCoverFile(file); setCoverPreview(URL.createObjectURL(file)); setCoverError('') }} />
      {(coverFile || coverPath) && <Button disabled={busy || uploadingCover} onClick={() => { setCoverFile(null); setCoverPreview(''); setCover(null); setCoverPath(''); setCoverError('') }}>移除封面</Button>}
      <ExtraFields className="book-form-cover-path"><ExtraHeading>封面路徑</ExtraHeading><div className="book-field"><span className="field-requirement" aria-hidden="true">選填</span><label><span className="field-caption">封面檔案路徑</span><input placeholder="covers/example.jpg" disabled={busy || uploadingCover} value={coverPath} onChange={(event) => { setCoverPath(event.target.value); setCoverFile(null); setCoverPreview('') }} /></label></div></ExtraFields>
      {coverError && <FormMessage tone="error">{coverError}</FormMessage>}
    </div>
    </>}
    </fieldset>
    <div className="book-form-footer">
    {error && <FormMessage tone="error">{error}</FormMessage>}
    {saveNotice && !error && <p role="status" className="book-save-notice">{saveNotice}</p>}
    <div className="form-actions"><Button disabled={busy || submitting || uploadingCover} onClick={onCancel}>{saveNotice ? '完成' : '取消'}</Button><Button disabled={busy || submitting || uploadingCover || previewReadOnly} type="submit" variant="primary">{previewReadOnly ? '此預覽不儲存' : uploadingCover ? '上傳封面中' : busy || submitting ? '儲存中' : '儲存'}</Button></div>
    </div>
  </form>
}


