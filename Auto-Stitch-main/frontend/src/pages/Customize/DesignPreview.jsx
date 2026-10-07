import { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { RefreshCw, Upload } from 'lucide-react';
import API_URL from '../../config/api';
import { fileToJpegDataUrl, MAX_PHOTO_MB, PHOTO_TYPES } from './imageUtils';
import './DesignPreview.css';

const toAbsolute = (url) => (/^https?:\/\//i.test(url) ? url : `${API_URL}${url}`);

/**
 * Shows the AI-customized design, then asks whether the customer wants to try it
 * on virtually before sending the request to boutiques.
 *
 * preview: { status: 'loading' | 'ready' | 'error' | 'unavailable', id, path, category, error }
 */
export default function DesignPreview({ preview, regenLeft, onRegenerate, onSend, sending }) {
  const [mode, setMode] = useState('ask'); // 'ask' | 'tryon'
  const [view, setView] = useState('design'); // 'design' | 'you'
  const [photo, setPhoto] = useState('');
  const [consent, setConsent] = useState(false);
  const [tryStatus, setTryStatus] = useState('idle'); // idle | loading | done | error
  const [tryResult, setTryResult] = useState('');
  const [tryError, setTryError] = useState('');
  const fileRef = useRef(null);

  // A new design invalidates any earlier try-on
  useEffect(() => {
    setMode('ask');
    setView('design');
    setTryStatus('idle');
    setTryResult('');
    setTryError('');
  }, [preview.id]);

  const ready = preview.status === 'ready';
  const designSrc = preview.path ? toAbsolute(preview.path) : '';

  const handlePhoto = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!PHOTO_TYPES.includes(file.type)) {
      setTryError('Please choose a JPG, PNG or WebP photo.');
      return;
    }
    if (file.size > MAX_PHOTO_MB * 1024 * 1024) {
      setTryError(`Photos must be smaller than ${MAX_PHOTO_MB} MB.`);
      return;
    }
    try {
      setPhoto(await fileToJpegDataUrl(file));
      setTryError('');
      setTryStatus('idle');
      setTryResult('');
      setView('design');
    } catch (error) {
      setTryError(error.message);
    }
  };

  const createTryOn = async () => {
    setTryStatus('loading');
    setTryError('');
    try {
      const { data } = await axios.post(
        `${API_URL}/api/custom-preview/try-on`,
        { previewId: preview.id, userPhoto: photo, category: preview.category },
        { withCredentials: true }
      );
      setTryResult(toAbsolute(data.resultImage));
      setTryStatus('done');
      setView('you');
    } catch (error) {
      setTryStatus('error');
      setTryError(error.response?.data?.message || 'Could not create the try-on. Please try again.');
    }
  };

  const changePhoto = () => {
    setPhoto('');
    setTryResult('');
    setTryStatus('idle');
    setView('design');
    fileRef.current?.click();
  };

  /* ---------- left column: the picture ---------- */
  const visual = (
    <div className="cp-visual">
      <div className="cp-frame">
        {preview.status === 'loading' && (
          <div className="cp-state">
            <span className="cp-spinner" aria-hidden="true" />
            <p className="cp-state-title">Creating your customized design</p>
            <p className="cp-state-text">We are applying your changes to the garment. This can take up to a minute.</p>
          </div>
        )}

        {ready && view === 'design' && <img loading="lazy" decoding="async" className="cp-image" src={designSrc} alt="Your customized design" />}
        {ready && view === 'you' && tryResult && <img loading="lazy" decoding="async" className="cp-image" src={tryResult} alt="Your customized design on you" />}

        {ready && tryStatus === 'loading' && (
          <div className="cp-overlay">
            <span className="cp-spinner" aria-hidden="true" />
            <p className="cp-state-text">Creating your try-on. This can take up to a minute.</p>
          </div>
        )}

        {(preview.status === 'error' || preview.status === 'unavailable') && (
          <div className="cp-state">
            <p className="cp-state-title">
              {preview.status === 'unavailable' ? 'Design previews are not available' : 'The preview could not be created'}
            </p>
            {preview.status === 'error' && <p className="cp-state-text">{preview.error}</p>}
          </div>
        )}
      </div>

      {ready && tryResult && (
        <div className="cp-tabs" role="tablist" aria-label="Preview view">
          <button type="button" role="tab" aria-selected={view === 'design'} className={view === 'design' ? 'active' : ''} onClick={() => setView('design')}>
            Design
          </button>
          <button type="button" role="tab" aria-selected={view === 'you'} className={view === 'you' ? 'active' : ''} onClick={() => setView('you')}>
            On you
          </button>
        </div>
      )}

      {ready && (
        <p className="cp-caption">
          AI-generated preview. Boutiques use it as a guide, so the finished garment may differ slightly.
        </p>
      )}
    </div>
  );

  /* ---------- right column: what to do next ---------- */
  let panel = null;

  if (preview.status === 'loading') {
    panel = (
      <>
        <h3 className="cp-title">Your design is on its way</h3>
        <p className="cp-text">
          When it is ready you can try it on virtually, or send your request straight to the boutiques.
        </p>
      </>
    );
  } else if (preview.status === 'unavailable') {
    panel = (
      <>
        <h3 className="cp-title">You can still send your request</h3>
        <p className="cp-text">Boutiques will work from your description and reference photos.</p>
        <div className="cp-actions">
          <button type="button" className="cp-btn primary" onClick={onSend} disabled={sending}>
            {sending ? 'Sending…' : 'Send request to boutiques'}
          </button>
        </div>
      </>
    );
  } else if (preview.status === 'error') {
    panel = (
      <>
        <h3 className="cp-title">Something went wrong</h3>
        <p className="cp-text">You can try again, or send your request without a preview.</p>
        <div className="cp-actions">
          <button type="button" className="cp-btn primary" onClick={onRegenerate} disabled={sending}>
            Try again
          </button>
          <button type="button" className="cp-btn" onClick={onSend} disabled={sending}>
            {sending ? 'Sending…' : 'Send without preview'}
          </button>
        </div>
      </>
    );
  } else if (ready && mode === 'ask') {
    panel = (
      <>
        <h3 className="cp-title">Here is your customized design</h3>
        <p className="cp-text">Would you like to see how it looks on you before you send your request?</p>
        <div className="cp-actions">
          <button type="button" className="cp-btn primary" onClick={() => setMode('tryon')} disabled={sending}>
            Yes, try it on
          </button>
          <button type="button" className="cp-btn" onClick={onSend} disabled={sending}>
            {sending ? 'Sending…' : 'No, send my request'}
          </button>
        </div>
        <button type="button" className="cp-link" onClick={onRegenerate} disabled={regenLeft <= 0 || sending}>
          <RefreshCw size={14} /> Create another version{regenLeft > 0 ? ` (${regenLeft} left)` : ''}
        </button>
      </>
    );
  } else if (ready && mode === 'tryon') {
    panel = (
      <>
        <h3 className="cp-title">Try it on</h3>
        <p className="cp-text">Upload a clear, front-facing photo of yourself, standing and well lit.</p>

        <input ref={fileRef} type="file" hidden accept="image/jpeg,image/png,image/webp" onChange={handlePhoto} />

        {photo ? (
          <div className="cp-photo">
            <img loading="lazy" decoding="async" src={photo} alt="Your photo" />
            <button type="button" className="cp-link" onClick={changePhoto} disabled={tryStatus === 'loading'}>
              Choose a different photo
            </button>
          </div>
        ) : (
          <button type="button" className="cp-drop" onClick={() => fileRef.current?.click()}>
            <Upload size={20} />
            <span>Choose a photo</span>
          </button>
        )}

        <label className="cp-consent">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <span>
            I agree to use this photo to create a try-on. It is not saved. The result is deleted from our server after
            about an hour, and an AI partner may process the photo to create it.
          </span>
        </label>

        {tryError && <p className="cp-error" role="alert">{tryError}</p>}

        <div className="cp-actions">
          {tryStatus === 'done' ? (
            <>
              <button type="button" className="cp-btn primary" onClick={onSend} disabled={sending}>
                {sending ? 'Sending…' : 'Send request to boutiques'}
              </button>
              <button type="button" className="cp-btn" onClick={changePhoto} disabled={sending}>
                Try another photo
              </button>
            </>
          ) : (
            <button
              type="button"
              className="cp-btn primary"
              onClick={createTryOn}
              disabled={!photo || !consent || tryStatus === 'loading'}
            >
              {tryStatus === 'loading' ? 'Creating try-on…' : 'Create try-on'}
            </button>
          )}
        </div>

        <button type="button" className="cp-link" onClick={() => setMode('ask')} disabled={tryStatus === 'loading' || sending}>
          Back to design
        </button>
      </>
    );
  }

  return (
    <section className="cp-section" aria-live="polite">
      {visual}
      <div className="cp-panel">{panel}</div>
    </section>
  );
}