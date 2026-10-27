// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { MultiSelect } from '../../src/shared/ui/MultiSelect'

function Harness() {
  const [value, setValue] = useState<string[]>(['c1'])
  return <MultiSelect kind="category" label="分類" options={[{ id: 'c1', label: '文學' }, { id: 'c2', label: '漫畫' }]} recommendations={[{ id: 'c2', label: '漫畫' }]} value={value} onChange={setValue} />
}
describe('MultiSelect', () => {
  it('searches, selects and removes existing options without creating arbitrary values', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: '移除文學' }))
    fireEvent.change(screen.getByLabelText('搜尋分類'), { target: { value: '漫畫' } })
    fireEvent.click(screen.getByRole('option', { name: '漫畫' }))
    expect(screen.getByRole('button', { name: '移除漫畫' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('搜尋分類'), { target: { value: '不存在' } })
    expect(screen.getByText('沒有符合的既有項目')).toBeTruthy()
  })
})
