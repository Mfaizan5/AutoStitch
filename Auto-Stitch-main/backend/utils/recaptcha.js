const verifyRecaptcha = async (captchaToken) => {
  const verificationEnabled =
    process.env.NODE_ENV === 'production'
    || process.env.RECAPTCHA_VERIFY_ENABLED !== 'false';
  if (!verificationEnabled) return { valid: true };

  const secret = process.env.RECAPTCHA_SECRET_KEY;
  if (!secret) {
    console.error('[reCAPTCHA] Verification is enabled but RECAPTCHA_SECRET_KEY is not configured.');
    return {
      valid: false,
      status: 503,
      message: 'CAPTCHA verification is not configured. Please contact support.',
    };
  }

  if (typeof captchaToken !== 'string' || !captchaToken.trim()) {
    return {
      valid: false,
      status: 400,
      message: 'Please complete the reCAPTCHA verification.',
    };
  }

  try {
    const response = await fetch('https://www.google.com/recaptcha/api/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        secret,
        response: captchaToken,
      }),
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      throw new Error(`reCAPTCHA verification returned HTTP ${response.status}.`);
    }

    const result = await response.json();
    if (result.success === true) return { valid: true };

    const errorCodes = result['error-codes'] || [];
    console.warn('[reCAPTCHA] Verification rejected:', errorCodes.join(', ') || 'unknown error');
    return {
      valid: false,
      status: 400,
      message: 'reCAPTCHA verification failed or expired. Please complete it again.',
    };
  } catch (error) {
    console.error('[reCAPTCHA] Verification service unavailable:', error.message);
    return {
      valid: false,
      status: 503,
      message: 'Unable to verify reCAPTCHA right now. Please try again shortly.',
    };
  }
};

module.exports = verifyRecaptcha;
