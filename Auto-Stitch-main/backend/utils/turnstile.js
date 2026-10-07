// Cloudflare Turnstile server-side verification.
// Enforced only when TURNSTILE_SECRET_KEY is set, so local tests and setups without a key keep working.
const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

const isTurnstileEnabled = () => !!process.env.TURNSTILE_SECRET_KEY;

const verifyTurnstile = async (token, remoteIp) => {
  if (!isTurnstileEnabled()) return true;
  if (!token || typeof token !== 'string') return false;
  try {
    const body = new URLSearchParams({ secret: process.env.TURNSTILE_SECRET_KEY, response: token });
    if (remoteIp) body.append('remoteip', remoteIp);
    const res = await fetch(VERIFY_URL, { method: 'POST', body, signal: AbortSignal.timeout(8000) });
    const data = await res.json();
    return data.success === true;
  } catch (err) {
    console.warn('[Turnstile] verification error:', err.message);
    return false;
  }
};

module.exports = { verifyTurnstile, isTurnstileEnabled };
