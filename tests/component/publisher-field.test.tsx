// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { createMetadata, type DictionaryEntry } from '../../src/domain'
import { PublisherField } from '../../src/features/books/PublisherField'
afterEach(cleanup)
const entry = (id:string,name:string,kind:'publisher'|'category'='publisher'):DictionaryEntry => ({...createMetadata({id,now:'2026-10-30T00:00:00.000Z'}),kind,name,color:null})
it('offers existing publishers only, filters by input and explicitly selects without writing on render', () => {
 const change=vi.fn(), entries=[entry('p1','野人文化'),entry('p2','人民文学出版社'),entry('p3',' 野人文化 '),entry('c1','文學小說','category')]
 const {rerender}=render(<PublisherField entries={entries} value="" onChange={change} />)
 expect(screen.getAllByRole('option')).toHaveLength(3)
 expect(change).not.toHaveBeenCalled()
 fireEvent.change(screen.getByLabelText('出版社',{exact:true}),{target:{value:'野人'}})
 expect(change).toHaveBeenLastCalledWith('野人')
 rerender(<PublisherField entries={entries} value="野人" onChange={change} />)
 expect(screen.queryByRole('option',{name:'人民文学出版社'})).toBeNull()
 fireEvent.change(screen.getByLabelText('選擇既有出版社'),{target:{value:'p1'}})
 expect(change).toHaveBeenLastCalledWith('野人文化')
})
it('keeps manually entered and unloaded names editable when no existing option matches', () => {
 const change=vi.fn()
 render(<PublisherField entries={[]} value="人工出版社" onChange={change} />)
 expect(screen.getByLabelText('出版社',{exact:true})).toHaveProperty('value','人工出版社')
 expect(screen.getByRole('option').textContent).toBe('沒有符合的既有出版社')
 fireEvent.change(screen.getByLabelText('出版社',{exact:true}),{target:{value:''}})
 expect(change).toHaveBeenLastCalledWith('')
})
