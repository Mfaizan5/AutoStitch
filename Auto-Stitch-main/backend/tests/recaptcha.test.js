const verifyRecaptcha = require('../utils/recaptcha');

describe('reCAPTCHA verification', () => {
  const originalSecret = process.env.RECAPTCHA_SECRET_KEY;
  const originalEnabled = process.env.RECAPTCHA_VERIFY_ENABLED;
  const originalNodeEnv = process.env.NODE_ENV;
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    process.env.RECAPTCHA_VERIFY_ENABLED = 'true';
    process.env.RECAPTCHA_SECRET_KEY = 'test-secret';
    global.fetch = jest.fn();
  });

  afterAll(() => {
    if (originalSecret === undefined) {
      delete process.env.RECAPTCHA_SECRET_KEY;
    } else {
      process.env.RECAPTCHA_SECRET_KEY = originalSecret;
    }
    if (originalEnabled === undefined) {
      delete process.env.RECAPTCHA_VERIFY_ENABLED;
    } else {
      process.env.RECAPTCHA_VERIFY_ENABLED = originalEnabled;
    }
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
    global.fetch = originalFetch;
  });

  it('skips local verification when explicitly disabled', async () => {
    process.env.NODE_ENV = 'development';
    process.env.RECAPTCHA_VERIFY_ENABLED = 'false';
    delete process.env.RECAPTCHA_SECRET_KEY;

    await expect(verifyRecaptcha()).resolves.toEqual({ valid: true });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('keeps verification enabled in production even if the local bypass flag is set', async () => {
    process.env.NODE_ENV = 'production';
    process.env.RECAPTCHA_VERIFY_ENABLED = 'false';
    delete process.env.RECAPTCHA_SECRET_KEY;

    await expect(verifyRecaptcha()).resolves.toMatchObject({
      valid: false,
      status: 503,
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('reports a missing verification secret when verification is enabled', async () => {
    delete process.env.RECAPTCHA_SECRET_KEY;

    await expect(verifyRecaptcha()).resolves.toMatchObject({
      valid: false,
      status: 503,
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('requires a token when server-side CAPTCHA verification is enabled', async () => {
    await expect(verifyRecaptcha()).resolves.toEqual({
      valid: false,
      status: 400,
      message: 'Please complete the reCAPTCHA verification.',
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('posts the token and secret as form data to Google', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });

    await expect(verifyRecaptcha('test-token')).resolves.toEqual({ valid: true });

    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toBe('https://www.google.com/recaptcha/api/siteverify');
    expect(options.method).toBe('POST');
    expect(options.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(options.body.get('secret')).toBe('test-secret');
    expect(options.body.get('response')).toBe('test-token');
  });

  it('rejects hostname mismatch responses rather than bypassing verification', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ success: false, 'error-codes': ['hostname-mismatch'] }),
    });

    await expect(verifyRecaptcha('test-token')).resolves.toMatchObject({
      valid: false,
      status: 400,
    });
  });

  it('reports verification service failures as temporarily unavailable', async () => {
    global.fetch.mockRejectedValue(new Error('network unavailable'));

    await expect(verifyRecaptcha('test-token')).resolves.toMatchObject({
      valid: false,
      status: 503,
    });
  });
});
