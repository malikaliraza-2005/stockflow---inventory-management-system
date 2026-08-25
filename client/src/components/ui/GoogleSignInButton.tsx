/**
 * GoogleSignInButton — renders Google's official Identity Services (GIS) button
 * and exchanges the returned ID token for a StockFlow session via POST
 * /auth/google. Both Login and Signup use it: the server resolves-or-provisions
 * by verified email, so one component backs "Sign in" and "Sign up with Google".
 *
 * Renders NOTHING when VITE_GOOGLE_CLIENT_ID is unset — Google sign-in is simply
 * off for that environment and email/password is unaffected. On success the
 * auth store hydrates and the parent page's `isAuthenticated` redirect takes
 * over (no navigation here).
 */
import { useEffect, useRef, useState } from 'react';

import { loginWithGoogle } from '../../api/auth';
import { ApiError } from '../../api/client';
import { getConfig } from '../../config';
import { AlertBanner } from './AlertBanner';

const GIS_SRC = 'https://accounts.google.com/gsi/client';

/** The slice of the GIS global we use (Google ships no bundled types). */
interface GoogleCredentialResponse {
  credential?: string;
}
interface GoogleIdApi {
  initialize(opts: {
    client_id: string;
    callback: (response: GoogleCredentialResponse) => void;
  }): void;
  renderButton(el: HTMLElement, opts: Record<string, unknown>): void;
}
declare global {
  interface Window {
    google?: { accounts?: { id?: GoogleIdApi } };
  }
}

/** Load the GIS script exactly once, shared across button instances. */
let scriptPromise: Promise<void> | undefined;
function loadGis(): Promise<void> {
  scriptPromise ??= new Promise<void>((resolve, reject) => {
    if (document.querySelector(`script[src="${GIS_SRC}"]`)) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = GIS_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Google sign-in'));
    document.head.appendChild(script);
  });
  return scriptPromise;
}

export interface GoogleSignInButtonProps {
  /** GIS button caption — 'signin_with' (Login) or 'signup_with' (Signup). */
  text?: 'signin_with' | 'signup_with' | 'continue_with';
}

export function GoogleSignInButton({ text = 'signin_with' }: GoogleSignInButtonProps) {
  const clientId = getConfig().googleClientId;
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;

    loadGis()
      .then(() => {
        if (cancelled) return;
        const idApi = window.google?.accounts?.id;
        const el = containerRef.current;
        if (!idApi || !el) return;

        idApi.initialize({
          client_id: clientId,
          callback: (response) => {
            if (!response.credential) {
              setError('Google sign-in was cancelled.');
              return;
            }
            setError(undefined);
            loginWithGoogle(response.credential).catch((err: unknown) => {
              // Surface the server's actual reason (e.g. "Google sign-in is not
              // available." = server missing GOOGLE_CLIENT_ID / not restarted).
              setError(
                err instanceof ApiError ? err.message : 'Google sign-in failed. Please try again.',
              );
            });
          },
        });
        idApi.renderButton(el, { theme: 'outline', size: 'large', text, width: 320 });
      })
      .catch(() => setError('Could not load Google sign-in.'));

    return () => {
      cancelled = true;
    };
  }, [clientId, text]);

  if (!clientId) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 text-xs font-medium text-neutral-400">
        <span className="h-px flex-1 bg-linear-to-r from-transparent to-neutral-200" />
        or continue with
        <span className="h-px flex-1 bg-linear-to-l from-transparent to-neutral-200" />
      </div>
      {error && <AlertBanner tone="danger" message={error} />}
      <div ref={containerRef} className="flex justify-center" />
    </div>
  );
}
