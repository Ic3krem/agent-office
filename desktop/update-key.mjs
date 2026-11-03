// The release signing PUBLIC key, pinned in the app (Ed25519, raw 32 bytes, base64). Releases are signed offline with the matching
// private key (see docs/RELEASING.md); the app and install scripts refuse any manifest that does not verify against this key.
// Rotating the key means shipping a new build with the new value here, so keep the previous release signed by the old key until users move over.
export const RELEASE_PUBLIC_KEY = 'UOhtrcwZBBls13mV3jdJsk4V8xBZOB3cQNypRjN0Vcc=';
export const RELEASE_KEY_FINGERPRINT = '0b380644373af6f07c2d78149f958778c299cf673ca1c5b0152da0e0a6d76139'; // sha256 of the raw key bytes, for humans to compare
