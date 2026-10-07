import { useState, useRef, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import toast from 'react-hot-toast';
import {
  Scissors, CheckCircle, Info, Sparkles, Camera
} from 'lucide-react';
import API_URL from '../../config/api';
import RegionReference from './RegionReference';
import DesignPreview from './DesignPreview';
import './Customize.css';
import './RegionReference.css';

const CUSTOM_REGIONS = [
  { id: 'neckline', name: 'Neckline', icon: '👔' },
  { id: 'sleeves', name: 'Sleeves', icon: '👘' },
  { id: 'hemline', name: 'Hemline', icon: '📏' },
  { id: 'embroidery', name: 'Embroidery', icon: '🧵' },
  { id: 'collar', name: 'Collar', icon: '👕' },
];

const MAX_PER_REGION = 3;
const MAX_FILE_MB = 5; // matches the backend upload limit
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const UPLOAD_BATCH = 5; // backend accepts at most 5 files per upload request
const MAX_REGENERATIONS = 2; // extra design versions per visit to the last step (each one costs an AI call)
const IDLE_PREVIEW = { status: 'idle', id: '', path: '', category: 'dresses', error: '' };

const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export default function Customize() {
  const [searchParams] = useSearchParams();
  const rawProductId = searchParams.get('id');
  const productId = rawProductId || 'custom_project';
  const productName = searchParams.get('name') || (rawProductId ? 'Selected Item' : 'New Custom Project');
  const productImage = searchParams.get('image');
  const navigate = useNavigate();

  const [step, setStep] = useState(1); // 1: Regions, 2: References, 3: Review
  const [selectedRegions, setSelectedRegions] = useState([]);
  const [description, setDescription] = useState('');
  const [budget, setBudget] = useState('');
  // { [regionId]: [{ id, source: 'gallery' | 'catalogue', preview, file?, url?, productId?, productName? }] }
  const [regionRefs, setRegionRefs] = useState({});
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState(IDLE_PREVIEW);
  const [regenCount, setRegenCount] = useState(0);

  const blobUrlsRef = useRef(new Set());
  const uploadedUrlsRef = useRef(new Map()); // gallery photo id -> uploaded URL (so each photo is uploaded once)
  const previewTokenRef = useRef(0); // lets us ignore a preview that finished after the customer went back

  useEffect(() => {
    const user = localStorage.getItem('user');
    if (!user) {
      navigate('/login?redirect=customize');
      return;
    }

    document.title = 'AI Customization — Auto Stitch';
  }, [navigate]);

  // Free the in-browser previews when leaving the page
  useEffect(() => {
    const blobUrls = blobUrlsRef.current;
    return () => blobUrls.forEach((u) => URL.revokeObjectURL(u));
  }, []);

  const toggleRegion = (id) => {
    setSelectedRegions(prev =>
      prev.includes(id) ? prev.filter(r => r !== id) : [...prev, id]
    );
  };

  // Photos are kept if a region is switched off and on again, but only
  // regions that are currently selected are shown, reviewed and submitted.
  const activeRegions = selectedRegions
    .map((id) => CUSTOM_REGIONS.find((r) => r.id === id))
    .filter(Boolean);
  const allRefs = activeRegions.flatMap((r) =>
    (regionRefs[r.id] || []).map((ref) => ({ ...ref, region: r.id }))
  );

  const addFiles = (regionId, files) => {
    const current = regionRefs[regionId] || [];
    let room = MAX_PER_REGION - current.length;
    const accepted = [];
    let badType = 0;
    let tooBig = 0;
    let overLimit = 0;

    files.forEach((file) => {
      if (!ALLOWED_TYPES.includes(file.type)) { badType++; return; }
      if (file.size > MAX_FILE_MB * 1024 * 1024) { tooBig++; return; }
      if (room <= 0) { overLimit++; return; }
      const preview = URL.createObjectURL(file);
      blobUrlsRef.current.add(preview);
      accepted.push({ id: newId(), source: 'gallery', file, preview });
      room--;
    });

    if (accepted.length > 0) {
      setRegionRefs((prev) => ({ ...prev, [regionId]: [...(prev[regionId] || []), ...accepted] }));
    }
    if (badType) toast.error('Only JPG, PNG, WebP or GIF photos can be added.');
    if (tooBig) toast.error(`Photos must be smaller than ${MAX_FILE_MB} MB.`);
    if (overLimit) toast.error(`You can add up to ${MAX_PER_REGION} photos per region.`);
  };

  const addCatalogue = (regionId, items) => {
    const current = regionRefs[regionId] || [];
    const existing = new Set(current.map((r) => r.url).filter(Boolean));
    const room = MAX_PER_REGION - current.length;
    const fresh = items
      .filter((it) => !existing.has(it.url))
      .slice(0, Math.max(room, 0))
      .map((it) => ({
        id: newId(),
        source: 'catalogue',
        preview: it.url,
        url: it.url,
        productId: it.productId,
        productName: it.productName,
      }));
    if (fresh.length > 0) {
      setRegionRefs((prev) => ({ ...prev, [regionId]: [...(prev[regionId] || []), ...fresh] }));
    }
  };

  const removeRef = (regionId, refId) => {
    const target = (regionRefs[regionId] || []).find((r) => r.id === refId);
    if (target?.source === 'gallery' && blobUrlsRef.current.has(target.preview)) {
      URL.revokeObjectURL(target.preview);
      blobUrlsRef.current.delete(target.preview);
    }
    setRegionRefs((prev) => ({ ...prev, [regionId]: (prev[regionId] || []).filter((r) => r.id !== refId) }));
  };

  // Uploads any gallery photos that are not on the server yet and returns the
  // per-region list in the shape the API expects. Catalogue photos are already hosted.
  const buildRegionReferences = async () => {
    const pending = allRefs.filter((r) => r.source === 'gallery' && !uploadedUrlsRef.current.has(r.id));

    for (let i = 0; i < pending.length; i += UPLOAD_BATCH) {
      const batch = pending.slice(i, i + UPLOAD_BATCH);
      const formData = new FormData();
      batch.forEach((r) => formData.append('images', r.file));

      const uploadRes = await axios.post(`${API_URL}/api/upload/multi`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        withCredentials: true
      });
      const urls = uploadRes.data.urls || [];
      if (urls.length !== batch.length) {
        throw new Error('Some photos could not be uploaded. Please try again.');
      }
      batch.forEach((r, idx) => uploadedUrlsRef.current.set(r.id, urls[idx]));
    }

    return allRefs.map((r) => ({
      region: r.region,
      image: r.source === 'gallery' ? uploadedUrlsRef.current.get(r.id) : r.url,
      source: r.source,
      ...(r.productId ? { productId: String(r.productId) } : {}),
      ...(r.productName ? { productName: r.productName } : {}),
    }));
  };

  const generatePreview = async () => {
    const token = ++previewTokenRef.current;
    setPreview({ ...IDLE_PREVIEW, status: 'loading' });

    try {
      const regionReferences = await buildRegionReferences();
      const { data } = await axios.post(`${API_URL}/api/custom-preview`, {
        productId,
        selectedRegions,
        description,
        regionReferences
      }, { withCredentials: true });

      if (token !== previewTokenRef.current) return; // the customer went back, this result is stale
      setPreview({ status: 'ready', id: data.previewId, path: data.previewPath, category: data.category || 'dresses', error: '' });
    } catch (error) {
      if (token !== previewTokenRef.current) return;
      if (error.response?.data?.code === 'PREVIEW_NOT_CONFIGURED') {
        setPreview({ ...IDLE_PREVIEW, status: 'unavailable' });
      } else {
        setPreview({
          ...IDLE_PREVIEW,
          status: 'error',
          error: error.response?.data?.message || error.message || 'Please check your connection and try again.'
        });
      }
    }
  };

  const goToConfirm = () => {
    setRegenCount(0);
    setStep(3);
    generatePreview();
  };

  // Only a finished design counts as a used version; retrying after an error is free
  const regenerate = () => {
    if (preview.status === 'ready') setRegenCount((n) => n + 1);
    generatePreview();
  };

  const backFromConfirm = () => {
    previewTokenRef.current++; // discard a preview that is still being made
    setPreview(IDLE_PREVIEW);
    setStep(2);
  };

  const handleSubmit = async () => {
    if (!budget || isNaN(Number(budget)) || Number(budget) <= 0) {
      toast.error('Please enter a valid budget.');
      return;
    }

    setLoading(true);
    try {
      const regionReferences = await buildRegionReferences();
      const referenceImages = [...new Set(regionReferences.map((r) => r.image))];

      const response = await axios.post(`${API_URL}/api/bids/request`, {
        productId,
        selectedRegions,
        description,
        budget: Number(budget),
        referenceImages,
        regionReferences,
        ...(preview.status === 'ready' ? { previewImage: `${API_URL}${preview.path}` } : {})
      }, { withCredentials: true });

      if (response.data.success) {
        navigate('/bids');
      } else {
        toast.error(response.data.message || 'Failed to broadcast request.');
      }
    } catch (error) {
      console.error('Submit error:', error);
      if (error.response?.status === 401) {
        toast.error('Your session has expired. Please log in again to continue.');
        navigate('/login?redirect=customize');
      } else {
        toast.error(error.response?.data?.message || error.message || 'A network error occurred. Please check your connection.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="dashboard-page page-enter">
      <div className="container dashboard-container" style={{ justifyContent: 'center' }}>
        <main className="dashboard-main" style={{ flex: 1, width: '100%', maxWidth: '1000px', margin: '0 auto' }}>

          <div className="dashboard-section" style={{ textAlign: 'center' }}>
            <h2 className="dashboard-section-title">AI Custom Stitching</h2>
            <p className="text-muted" style={{ marginBottom: '2rem', fontSize: '0.85rem', marginLeft: 'auto', marginRight: 'auto', maxWidth: '600px' }}>
              Modify specific garment regions and receive competitive bids from our premier boutiques.
              Powered by structural AI modification tools.
            </p>
          </div>

          {/* Stepper (Matching VTON feel) */}
          <div className="customize-stepper-v2">
            {[1, 2, 3].map(s => (
              <div key={s} className={`step-v2 ${step === s ? 'active' : step > s ? 'done' : ''}`}>
                <div className="step-v2-num">{step > s ? <CheckCircle size={14} /> : s}</div>
                <span className="step-v2-label">
                  {s === 1 ? 'Regions' : s === 2 ? 'References' : 'Confirm'}
                </span>
                {s < 3 && <div className="step-v2-line" />}
              </div>
            ))}
          </div>

          <div className="customize-content-wrap">
            {/* STEP 1: REGIONS */}
            {step === 1 && (
              <div className="step-content-v2">
                <div className="upload-grid">
                  <div className="upload-section">
                    <h3 className="upload-section-title">
                      <Scissors size={18} /> Select Regions
                    </h3>
                    <div className="regions-selection-grid">
                      {CUSTOM_REGIONS.map(r => (
                        <button
                          key={r.id}
                          className={`region-pill ${selectedRegions.includes(r.id) ? 'active' : ''}`}
                          onClick={() => toggleRegion(r.id)}
                        >
                          <span className="region-pill-icon">{r.icon}</span>
                          <span className="region-pill-name">{r.name}</span>
                          {selectedRegions.includes(r.id) && <CheckCircle size={12} className="check" />}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="upload-section">
                    <h3 className="upload-section-title">
                      <Sparkles size={18} /> Selected Garment
                    </h3>
                    <div className="upload-dropzone filled">
                      {productImage ? (
                        <img loading="lazy" decoding="async" src={productImage} alt={productName} className="upload-preview" />
                      ) : (
                        <div className="upload-placeholder">
                          <p className="upload-hint">No image available</p>
                        </div>
                      )}
                      <div className="garment-overlay-label">
                        <span>{productName}</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="upload-action" style={{ marginTop: '2rem' }}>
                  <button
                    className="btn-black"
                    disabled={selectedRegions.length === 0}
                    onClick={() => setStep(2)}
                  >
                    CONTINUE TO DETAILS
                  </button>
                </div>
              </div>
            )}

            {/* STEP 2: REFERENCES */}
            {step === 2 && (
              <div className="step-content-v2">
                <div className="details-layout with-region-refs">
                  <div className="details-form-side">
                    <h3 className="upload-section-title"><Info size={18} /> Modification Details</h3>

                    <div className="custom-form-group">
                      <label>Describe your vision</label>
                      <textarea
                        placeholder="E.g., I want the neckline to be V-shaped with gold embroidery..."
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        className="custom-textarea"
                        rows={5}
                      />
                    </div>

                    <div className="custom-form-group">
                      <label>Estimated Budget (PKR)</label>
                      <input
                        type="number"
                        placeholder="e.g. 5000"
                        value={budget}
                        onChange={(e) => setBudget(e.target.value)}
                        className="custom-input"
                        required
                      />
                    </div>
                  </div>

                  <div className="details-upload-side">
                    <h3 className="upload-section-title"><Camera size={18} /> Reference Photos</h3>
                    <p className="rr-intro">
                      Show the boutique what you want for each region. Add up to {MAX_PER_REGION} photos per region,
                      from your gallery or from our catalogue.
                    </p>
                    <RegionReference
                      regions={activeRegions}
                      refsByRegion={regionRefs}
                      maxPerRegion={MAX_PER_REGION}
                      onAddFiles={addFiles}
                      onAddCatalogue={addCatalogue}
                      onRemove={removeRef}
                    />
                  </div>
                </div>

                <div className="upload-action" style={{ marginTop: '3rem', flexDirection: 'row', gap: '1rem' }}>
                  <button className="btn btn-outline" style={{ flex: 1, height: '60px', borderRadius: '0' }} onClick={() => setStep(1)}>
                    BACK
                  </button>
                  <button
                    className="btn-black"
                    style={{ flex: 2 }}
                    disabled={!description.trim() || allRefs.length === 0 || !budget}
                    onClick={goToConfirm}
                  >
                    PREVIEW REQUEST
                  </button>
                </div>
              </div>
            )}

            {/* STEP 3: REVIEW */}
            {step === 3 && (
              <div className="step-content-v2">
                <DesignPreview
                  preview={preview}
                  regenLeft={Math.max(0, MAX_REGENERATIONS - regenCount)}
                  onRegenerate={regenerate}
                  onSend={handleSubmit}
                  sending={loading}
                />

                <div className="review-v2-card">
                  <div className="review-v2-header">
                    <div className="success-badge">
                      <CheckCircle size={16} />
                      <span>Ready to Broadcast</span>
                    </div>
                    <h2>Review Your Request</h2>
                  </div>

                  <div className="review-v2-grid">
                    <div className="review-item">
                      <label>Target Regions</label>
                      <div className="review-tags">
                        {selectedRegions.map(r => <span key={r} className="review-tag">{r}</span>)}
                      </div>
                    </div>
                    <div className="review-item">
                      <label>Budget</label>
                      <span className="review-value">PKR {budget}</span>
                    </div>
                    <div className="review-item" style={{ gridColumn: 'span 2' }}>
                      <label>Description</label>
                      <p className="review-desc">{description}</p>
                    </div>
                    <div className="review-item" style={{ gridColumn: 'span 2' }}>
                      <label>Reference Photos</label>
                      <div className="rr-review">
                        {activeRegions.map((r) => {
                          const list = regionRefs[r.id] || [];
                          return (
                            <div key={r.id} className="rr-review-row">
                              <span className="review-tag">{r.name}</span>
                              {list.length > 0 ? (
                                <div className="review-refs">
                                  {list.map((ref) => (
                                    <img loading="lazy" decoding="async" key={ref.id} src={ref.preview} alt={`${r.name} reference`} className="review-img" />
                                  ))}
                                </div>
                              ) : (
                                <span className="rr-review-none">No photo added</span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="upload-action" style={{ marginTop: '3rem', flexDirection: 'row', gap: '1rem' }}>
                  <button
                    className="btn btn-outline"
                    style={{ flex: '0 0 auto', minWidth: '220px', height: '60px', borderRadius: '0' }}
                    disabled={loading}
                    onClick={backFromConfirm}
                  >
                    BACK
                  </button>
                </div>
              </div>
            )}
          </div>

        </main>
      </div>
    </div>
  );
}