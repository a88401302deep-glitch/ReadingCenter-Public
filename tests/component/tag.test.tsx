// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Tag } from '../../src/shared/ui/Tag'

describe('Tag', () => {
  it('keeps category and tag in different visual classes', () => {
    render(<><Tag kind="category">推理</Tag><Tag kind="tag">療癒</Tag></>)
    expect(screen.getByText('推理').classList.contains('tag--category')).toBe(true)
    expect(screen.getByText('療癒').classList.contains('tag--tag')).toBe(true)
  })
})
