import { unsafeCSS } from 'lit-element';

/** The phone layout applies at or below this width (CSS px). */
export const PHONE_MAX_WIDTH = 640;

/** For css`` templates: `@media ${phoneMedia} { … }`. */
export const phoneMedia = unsafeCSS(`(max-width: ${PHONE_MAX_WIDTH}px)`);
