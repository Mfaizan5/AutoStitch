import { useRef, useState } from 'react';
import { Upload, LayoutGrid, X } from 'lucide-react';
import CataloguePicker from './CataloguePicker';
import './RegionReference.css';

function RegionCard({ region, refs, max, onAddFiles, onOpenCatalogue, onRemove }) {
  const inputRef = useRef(null);
  const full = refs.length >= max;

  return (
    <div className="rr-card">
      <div className="rr-card-head">
        <span className="rr-card-title">
          <span aria-hidden="true">{region.icon}</span>
          {region.name}
        </span>
        <span className="rr-count">{refs.length}/{max} photos</span>
      </div>

      {refs.length > 0 && (
        <div className="rr-thumbs">
          {refs.map((r) => (
            <div key={r.id} className="rr-thumb">
              <img loading="lazy" decoding="async" src={r.preview} alt={`${region.name} reference`} />
              <span className="rr-thumb-source">{r.source === 'catalogue' ? 'Catalogue' : 'Gallery'}</span>
              <button
                type="button"
                className="rr-thumb-remove"
                aria-label={`Remove ${region.name} photo`}
                onClick={() => onRemove(region.id, r.id)}
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="rr-actions">
        <button type="button" className="rr-btn" disabled={full} onClick={() => inputRef.current?.click()}>
          <Upload size={15} /> From gallery
        </button>
        <button type="button" className="rr-btn" disabled={full} onClick={() => onOpenCatalogue(region)}>
          <LayoutGrid size={15} /> From catalogue
        </button>
      </div>

      <input
        ref={inputRef}
        type="file"
        hidden
        multiple
        accept="image/jpeg,image/png,image/webp,image/gif"
        onChange={(e) => {
          onAddFiles(region.id, Array.from(e.target.files || []));
          e.target.value = ''; // allow picking the same file again later
        }}
      />
    </div>
  );
}

export default function RegionReference({ regions, refsByRegion, maxPerRegion, onAddFiles, onAddCatalogue, onRemove }) {
  const [pickerRegion, setPickerRegion] = useState(null);
  const pickerRefs = pickerRegion ? refsByRegion[pickerRegion.id] || [] : [];

  return (
    <>
      <div className="rr-list">
        {regions.map((region) => (
          <RegionCard
            key={region.id}
            region={region}
            refs={refsByRegion[region.id] || []}
            max={maxPerRegion}
            onAddFiles={onAddFiles}
            onOpenCatalogue={setPickerRegion}
            onRemove={onRemove}
          />
        ))}
      </div>

      {pickerRegion && (
        <CataloguePicker
          regionName={pickerRegion.name}
          remaining={maxPerRegion - pickerRefs.length}
          alreadyAdded={pickerRefs.map((r) => r.url).filter(Boolean)}
          onClose={() => setPickerRegion(null)}
          onConfirm={(items) => {
            onAddCatalogue(pickerRegion.id, items);
            setPickerRegion(null);
          }}
        />
      )}
    </>
  );
}
