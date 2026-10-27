// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Button } from '../../src/shared/ui/Button'
import { Popover } from '../../src/shared/ui/Popover'

describe('Popover', () => {
  it('opens from a real trigger element and closes with Escape', () => {
    render(
      <Popover
        content={<span>第 1 次閱讀</span>}
        label="閱讀歷程"
        trigger={(props) => <Button {...props}>閱讀歷程</Button>}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '閱讀歷程' }))
    expect(screen.getByRole('dialog', { name: '閱讀歷程' })).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: '閱讀歷程' })).toBeNull()
  })
})
