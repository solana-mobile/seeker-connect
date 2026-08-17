/**
 * Seeker-Connect-owned UI: the progress overlay and error dialogs shown
 * around wallet interactions. Lit custom elements in Shadow DOM; no host
 * page styling is required or affected.
 */
export { FOOTER_WORDMARK_PATHS, S_MARK_ARC_PATH, S_MARK_PATH } from './brand.js';
export { SeekerConnectButton, type SeekerConnectButtonVariant } from './elements/connectButton.js';
export { SeekerConnectErrorDialog } from './elements/errorDialog.js';
export { SeekerConnectProgress } from './elements/progress.js';
export {
	createSeekerConnectPresenter,
	defineSeekerConnectElements,
	type SeekerConnectPresenterOptions,
} from './presenter.js';
