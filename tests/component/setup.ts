import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// JSDOM does not implement the native dialog top layer; exercise its open/close state.
if (typeof HTMLDialogElement !== 'undefined' && !HTMLDialogElement.prototype.showModal) {
 HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
 HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
}
afterEach(cleanup)
