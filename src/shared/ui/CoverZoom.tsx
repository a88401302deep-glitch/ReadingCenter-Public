import { useState } from 'react'
import type { Book } from '../../domain'
import { getBookDisplayTitle } from '../../domain'
import { BookCover } from './BookCover'
import { Modal } from './Modal'
import { Icon } from './Icon'
export function CoverZoom({ book, onOpen }: { book: Book; onOpen: (book: Book) => void }) {
 const [open, setOpen] = useState(false)
 const title = getBookDisplayTitle(book)
 return <><button className="cover-zoom-trigger" type="button" aria-label={`放大《${title}》封面`} onClick={() => setOpen(true)}><Icon name="search" size={17} /></button><Modal open={open} title={title} onClose={() => setOpen(false)}><div className="cover-lightbox"><BookCover src={book.cover?.path} title={title} /><button className="button" type="button" onClick={() => { setOpen(false); onOpen(book) }}>前往書籍資料</button></div></Modal></>
}
