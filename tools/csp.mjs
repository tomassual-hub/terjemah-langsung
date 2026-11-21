// Security headers shared by the dev server (tools/serve.mjs) and the Netlify _headers file (tools/build.mjs).
// Everything the app runs comes from our own origin, so the policy is strict: no third-party scripts, no eval, no inline script
// or style attributes. The only outside hosts are the translation services, and only as DATA (connect-src):
//   api.mymemory.translated.net          MyMemory: free, no key (the default)
//   translation.googleapis.com           Google Cloud Translation v2: the user's own API key
//   api.cognitive.microsofttranslator.com Microsoft Translator (Azure): the user's own key
// All three answer CORS from the browser, so there is no proxy of ours in between and a key never passes through our server.
// The microphone is allowed for our own origin only: speech recognition (Web Speech API) needs it.
//
// Netlify's free plan injects a "Powered by Netlify" badge with one inline <script> and an inline <style>; the Netlify build
// allows exactly that script by its hash (netlifyBadge: true). Local runs and the tests stay strict.

export const NETLIFY_BADGE_SCRIPT_HASH = "'sha256-BkKP2XO6WOEc3kXOiLr2ZoY83hamalKjPY9xBcbXVuw='";

export const API_HOSTS = ['https://api.mymemory.translated.net', 'https://translation.googleapis.com', 'https://api.cognitive.microsofttranslator.com'];

export function buildCsp({ netlifyBadge = false } = {}) {
  return [
    "default-src 'self'",
    `script-src 'self'${netlifyBadge ? ` ${NETLIFY_BADGE_SCRIPT_HASH}` : ''}`,
    "style-src 'self'",
    ...(netlifyBadge ? ["style-src-elem 'self' 'unsafe-inline'", "style-src-attr 'none'"] : []),
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src 'self' ${API_HOSTS.join(' ')}`,
    "media-src 'self' blob:",
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}

export const CSP = buildCsp();

export function securityHeaders({ netlifyBadge = false } = {}) {
  return {
    'Content-Security-Policy': buildCsp({ netlifyBadge }),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin', // Google API keys restricted to "HTTP referrers" need the origin
    'Permissions-Policy': 'camera=(), microphone=(self), geolocation=(), payment=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
  };
}

/** The same policy minus frame-ancestors (ignored in <meta>), for hosts where headers cannot be set. */
export const metaCsp = opts => buildCsp(opts).replace("; frame-ancestors 'none'", '');
