/**
 * Komponen tombol "Aktifkan AI WA Bot" untuk dashboard Lapakin.
 * 
 * Cara pakai di dashboard Lapakin:
 * import AIWaBotConnect from './AIWaBotConnect';
 * <AIWaBotConnect />
 * 
 * Letakkan di halaman dashboard owner Lapakin.
 */

import { useState } from 'react';
import axios from 'axios';

export default function AIWaBotConnect() {
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');

  const handleConnect = async () => {
    setLoading(true);
    setError('');
    try {
      const r = await axios.post('/api/bot/connect-token', {}, {
        withCredentials: true,
      });
      // Redirect ke bot.dev dengan token
      window.location.href = r.data.redirect_url;
    } catch (err) {
      setError(err.response?.data?.detail || 'Gagal generate token. Coba lagi.');
      setLoading(false);
    }
  };

  return (
    <div style={{
      background: 'linear-gradient(135deg, #16a34a, #15803d)',
      borderRadius: 16,
      padding: 24,
      color: '#fff',
      marginBottom: 20,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <div style={{
          width: 48, height: 48,
          background: 'rgba(255,255,255,0.2)',
          borderRadius: 12,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 24,
        }}>
          🤖
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 800, fontSize: '1rem', marginBottom: 4 }}>
            AI WA Bot
          </div>
          <div style={{ fontSize: '0.82rem', opacity: 0.85 }}>
            Aktifkan asisten WhatsApp otomatis untuk toko kamu
          </div>
        </div>
        <button
          onClick={handleConnect}
          disabled={loading}
          style={{
            background: '#fff',
            color: '#16a34a',
            border: 'none',
            borderRadius: 10,
            padding: '10px 20px',
            fontWeight: 700,
            fontSize: '0.875rem',
            cursor: loading ? 'not-allowed' : 'pointer',
            opacity: loading ? 0.7 : 1,
            whiteSpace: 'nowrap',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          {loading ? (
            <>
              <span style={{
                width: 14, height: 14,
                border: '2px solid #16a34a',
                borderTopColor: 'transparent',
                borderRadius: '50%',
                display: 'inline-block',
                animation: 'spin 0.7s linear infinite',
              }} />
              Memproses...
            </>
          ) : (
            '🚀 Aktifkan Sekarang'
          )}
        </button>
      </div>
      {error && (
        <div style={{
          marginTop: 12,
          background: 'rgba(255,255,255,0.15)',
          borderRadius: 8,
          padding: '8px 12px',
          fontSize: '0.82rem',
        }}>
          ⚠ {error}
        </div>
      )}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
