/**
 * Seeker Connect web SDK: the imperative entry point for dapps that do not
 * use Wallet Standard.
 */
export type {
	AuthorizationCache,
	DappIdentity,
	SeekerAccount,
	SeekerAuthorization,
	SeekerAuthorizeRequest,
	SeekerChain,
	SeekerConnectConfig,
	SeekerLink,
	SeekerSignAndSendOptions,
	SeekerSignInPayload,
	SeekerSignInResult,
	SeekerTransactOptions,
	SeekerWallet,
	SeekerWalletCapabilities,
	StoredAuthorization,
} from '@skr-connect/core';
export { DEFAULT_SEEKER_CHAIN, SeekerConnectError, SeekerConnectErrorCode } from '@skr-connect/core';
export { createNostrSeekerLink } from './mwa-adapter/index.js';
