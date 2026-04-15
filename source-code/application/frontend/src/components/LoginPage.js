import React, { useState } from 'react';
import { Dna, Lock, User, Loader, Eye, EyeOff } from 'lucide-react';
import { login } from '../services/api';

function LoginPage({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const { data } = await login({ username, password });
      localStorage.setItem('token', data.token);
      localStorage.setItem('username', data.username);
      onLogin(data.token, data.username);
    } catch (err) {
      setError('Invalid username or password.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ 
      display: 'flex', 
      alignItems: 'center', 
      justifyContent: 'center', 
      minHeight: '100vh', 
      position: 'relative',
      padding: '20px'
    }}>
      <div className="card" style={{ 
        width: '100%', 
        maxWidth: '420px', 
        padding: '48px', 
        zIndex: 1
      }}>
        <div style={{ textAlign: 'center', marginBottom: '36px' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: '20px' }}>
            <img src={`${process.env.PUBLIC_URL}/vastdata-logo.png`} alt="VAST Data" style={{ height: '48px', objectFit: 'contain' }} />
          </div>
          <h2 style={{ 
            fontSize: '28px', 
            color: 'var(--text-primary)', 
            marginBottom: '8px', 
            fontWeight: 700,
            letterSpacing: '-0.5px'
          }}>VASTRiant</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '15px', fontWeight: 400 }}>Genomic AI Pipeline powered by <span style={{ color: 'var(--accent)', fontWeight: 600 }}>VAST DataEngine</span></p>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '20px' }}>
            <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '8px', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.5px' }}>Username</label>
            <div style={{ position: 'relative' }}>
              <User size={18} style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                style={{ width: '100%', padding: '14px 14px 14px 44px', background: 'rgba(14, 26, 53, 0.6)', border: '1px solid rgba(84, 231, 222, 0.15)', color: 'var(--text-primary)', borderRadius: '8px', fontSize: '15px', transition: 'all 0.2s ease', boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.2)' }}
                onFocus={(e) => { e.target.style.borderColor = 'var(--accent)'; e.target.style.background = 'rgba(14, 26, 53, 0.8)'; }}
                onBlur={(e) => { e.target.style.borderColor = 'rgba(84, 231, 222, 0.15)'; e.target.style.background = 'rgba(14, 26, 53, 0.6)'; }}
              />
            </div>
          </div>

          <div style={{ marginBottom: '30px' }}>
            <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '8px', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.5px' }}>Password</label>
            <div style={{ position: 'relative' }}>
              <Lock size={18} style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                style={{ width: '100%', padding: '14px 44px 14px 44px', background: 'rgba(14, 26, 53, 0.6)', border: '1px solid rgba(84, 231, 222, 0.15)', color: 'var(--text-primary)', borderRadius: '8px', fontSize: '15px', transition: 'all 0.2s ease', boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.2)' }}
                onFocus={(e) => { e.target.style.borderColor = 'var(--accent)'; e.target.style.background = 'rgba(14, 26, 53, 0.8)'; }}
                onBlur={(e) => { e.target.style.borderColor = 'rgba(84, 231, 222, 0.15)'; e.target.style.background = 'rgba(14, 26, 53, 0.6)'; }}
              />
              <button 
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                style={{ position: 'absolute', right: '14px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: 0, transition: 'color 0.2s' }}
                title={showPassword ? "Hide password" : "Show password"}
                onMouseOver={(e) => e.currentTarget.style.color = 'var(--accent)'}
                onMouseOut={(e) => e.currentTarget.style.color = 'var(--text-muted)'}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          {error && (
            <div style={{ 
              color: '#FF6B6B', 
              fontSize: '14px', 
              marginBottom: '20px', 
              textAlign: 'center',
              background: 'rgba(255, 107, 107, 0.1)',
              padding: '10px',
              borderRadius: '6px',
              border: '1px solid rgba(255, 107, 107, 0.2)'
            }}>
              {error}
            </div>
          )}

          <button 
            type="submit" 
            className="btn btn-primary" 
            style={{ width: '100%', padding: '14px', display: 'flex', justifyContent: 'center', fontSize: '16px', fontWeight: 600, borderRadius: '8px', letterSpacing: '0.5px', boxShadow: '0 4px 12px rgba(84, 231, 222, 0.2)', border: '1px solid rgba(84, 231, 222, 0.4)' }} 
            disabled={loading}
          >
            {loading ? <Loader className="spinner" size={20} style={{ margin: 0 }} /> : 'Sign In'}
          </button>
        </form>
      </div>
      
      <div style={{ position: 'absolute', bottom: '30px', display: 'flex', alignItems: 'center', gap: '8px', opacity: 0.7, transition: 'opacity 0.2s ease' }}>
        <span style={{ fontSize: '13px', color: 'var(--text-secondary)', fontWeight: 500 }}>Powered by</span>
        <a 
          href="https://vastdata.com" 
          target="_blank" 
          rel="noopener noreferrer"
          style={{ display: 'flex', alignItems: 'center', gap: '6px', textDecoration: 'none', color: 'var(--text-primary)', fontWeight: 700, letterSpacing: '0.5px', transition: 'color 0.2s ease' }}
          onMouseOver={(e) => { e.currentTarget.style.color = 'var(--accent)'; e.currentTarget.parentElement.style.opacity = 1; }}
          onMouseOut={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; e.currentTarget.parentElement.style.opacity = 0.7; }}
        >
          <img src="https://vastdata.com/favicon.ico" alt="VAST Data" style={{ width: '16px', height: '16px', filter: 'brightness(0) invert(1)' }} />
          VAST Data
        </a>
      </div>
    </div>
  );
}

export default LoginPage;
