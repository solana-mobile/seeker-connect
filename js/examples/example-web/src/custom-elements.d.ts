import type { SeekerConnectButton, SeekerConnectButtonVariant } from '@skr-connect/ui';
import type { DetailedHTMLProps, HTMLAttributes } from 'react';

declare module 'react' {
	namespace JSX {
		interface IntrinsicElements {
			'seeker-connect-button': DetailedHTMLProps<HTMLAttributes<SeekerConnectButton>, SeekerConnectButton> & {
				variant?: SeekerConnectButtonVariant;
				theme?: 'light' | 'dark';
				disabled?: boolean;
			};
		}
	}
}
