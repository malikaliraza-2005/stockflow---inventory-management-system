/**
 * Google ID-token verification (AAD — Google sign-in). Wraps google-auth-library's
 * OAuth2Client.verifyIdToken: it checks the token's signature against Google's
 * rotating public keys, the `aud` (our OAuth client id), the `iss`, and expiry.
 *
 * Injected into AuthService as a plain function so the service stays testable
 * (unit tests pass a stub identity) and so an instance without GOOGLE_CLIENT_ID
 * simply has no verifier — Google sign-in is then "not available", never a crash.
 */
import { OAuth2Client } from 'google-auth-library';

import { UnauthorizedError } from '../errors/AppError.js';

export interface GoogleIdentity {
  /** Stable Google account id (the `sub` claim) — the real identity key. */
  sub: string;
  email: string;
  /** Google asserts the email is verified — the gate for auto-linking by email. */
  emailVerified: boolean;
  name?: string;
}

export type GoogleVerifier = (idToken: string) => Promise<GoogleIdentity>;

/** Build a verifier bound to our OAuth client id (the token's required audience). */
export function createGoogleVerifier(clientId: string): GoogleVerifier {
  const client = new OAuth2Client(clientId);
  return async (idToken: string): Promise<GoogleIdentity> => {
    let payload;
    try {
      const ticket = await client.verifyIdToken({ idToken, audience: clientId });
      payload = ticket.getPayload();
    } catch {
      // Signature/audience/expiry failure — never echo the reason to the client.
      throw new UnauthorizedError('Google sign-in failed. Please try again.');
    }
    if (!payload?.sub || !payload.email) {
      throw new UnauthorizedError('Google sign-in failed. Please try again.');
    }
    return {
      sub: payload.sub,
      email: payload.email,
      emailVerified: payload.email_verified === true,
      ...(payload.name ? { name: payload.name } : {}),
    };
  };
}
