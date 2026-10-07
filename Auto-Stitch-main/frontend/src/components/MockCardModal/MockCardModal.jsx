import { useState } from 'react';
import { CreditCard, Lock, X } from 'lucide-react';

const field = {
  width: '100%', padding: '12px 14px', border: '1px solid #ddd', borderRadius: '6px',
  fontSize: '0.95rem', boxSizing: 'border-box', background: '#fff', color: '#111'
};
const label = { display: 'block', fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#555', margin: '14px 0 6px' };

// Simulated card form: validates the format only and never contacts a payment network.
export default function MockCardModal({ amount, title = 'Card Payment', onClose, onPaid }) {
  const [number, setNumber] = useState('');
  const [name, setName] = useState('');
  const [expiry, setExpiry] = useState('');
  const [cvc, setCvc] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const formatNumber = (v) => v.replace(/\D/g, '').slice(0, 16).replace(/(.{4})/g, '$1 ').trim();
  const formatExpiry = (v) => {
    const d = v.replace(/\D/g, '').slice(0, 4);
    return d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d;
  };

  const validate = () => {
    if (number.replace(/\s/g, '').length !== 16) return 'Enter a 16-digit card number (test card: 4242 4242 4242 4242).';
    if (!name.trim()) return 'Enter the name on the card.';
    const m = expiry.match(/^(\d{2})\/(\d{2})$/);
    if (!m || +m[1] < 1 || +m[1] > 12) return 'Enter a valid expiry date (MM/YY).';
    const expiresAt = new Date(2000 + +m[2], +m[1], 0, 23, 59, 59);
    if (expiresAt < new Date()) return 'This card has expired.';
    if (!/^\d{3}$/.test(cvc)) return 'Enter the 3-digit CVC.';
    return '';
  };

  const submit = async (e) => {
    e.preventDefault();
    const problem = validate();
    if (problem) { setError(problem); return; }
    setError('');
    setBusy(true);
    try {
      await new Promise((r) => setTimeout(r, 900)); // pretend to contact the bank
      await onPaid();
    } catch (err) {
      setError(err.response?.data?.message || 'Payment could not be completed. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
      <form onSubmit={submit} style={{ background: '#fffef5', borderRadius: '12px', width: '100%', maxWidth: '420px', padding: '28px', boxShadow: '0 20px 60px rgba(0,0,0,0.3)', maxHeight: '95vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px', fontSize: '1.15rem' }}><CreditCard size={20} /> {title}</h3>
          <button type="button" onClick={onClose} disabled={busy} aria-label="Close" style={{ background: 'none', border: 'none', cursor: 'pointer' }}><X size={20} /></button>
        </div>

        <p style={{ margin: '12px 0 0', fontSize: '0.78rem', background: '#fff7e0', border: '1px solid #f0d98a', padding: '8px 10px', borderRadius: '6px', color: '#7a5b00' }}>
          Demo mode: this is a simulated payment. No real card is charged.
        </p>

        <p style={{ margin: '16px 0 0', fontSize: '0.8rem', color: '#555' }}>Amount to pay</p>
        <p style={{ margin: 0, fontSize: '1.5rem', fontWeight: 800 }}>PKR {Number(amount || 0).toLocaleString()}</p>

        <label style={label}>Card number</label>
        <input style={field} inputMode="numeric" autoComplete="off" placeholder="4242 4242 4242 4242" value={number} onChange={(e) => setNumber(formatNumber(e.target.value))} disabled={busy} autoFocus />

        <label style={label}>Name on card</label>
        <input style={field} placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} disabled={busy} />

        <div style={{ display: 'flex', gap: '12px' }}>
          <div style={{ flex: 1 }}>
            <label style={label}>Expiry</label>
            <input style={field} inputMode="numeric" placeholder="MM/YY" value={expiry} onChange={(e) => setExpiry(formatExpiry(e.target.value))} disabled={busy} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={label}>CVC</label>
            <input style={field} inputMode="numeric" placeholder="123" value={cvc} onChange={(e) => setCvc(e.target.value.replace(/\D/g, '').slice(0, 3))} disabled={busy} />
          </div>
        </div>

        {error && <p style={{ color: '#b91c1c', fontSize: '0.82rem', margin: '14px 0 0' }}>{error}</p>}

        <button type="submit" disabled={busy} style={{ marginTop: '20px', width: '100%', padding: '14px', background: '#000', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: 700, letterSpacing: '0.08em', cursor: busy ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
          <Lock size={16} /> {busy ? 'Processing...' : `Pay PKR ${Number(amount || 0).toLocaleString()}`}
        </button>
      </form>
    </div>
  );
}
