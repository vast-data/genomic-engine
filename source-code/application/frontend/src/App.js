import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { Search, GitBranch, Users, ClipboardList, Dna, LogOut, Settings, LayoutTemplate, Activity, Info, BookOpen, FlaskConical } from 'lucide-react';
import SearchPage from './components/SearchPage';
import PipelineDashboard from './components/PipelineDashboard';
import PipelineDetail from './components/PipelineDetail';
import PatientView from './components/PatientView';
import UploadPage from './components/UploadPage';
import MoleculesPage from './components/MoleculesPage';
import LoginPage from './components/LoginPage';
import PlatformDesign from './components/PlatformDesign';
import AboutModal from './components/AboutModal';
import TerminologyModal from './components/TerminologyModal';
import './App.css';

function NavBar({ username, onLogout }) {
  const navigate = useNavigate();
  const location = useLocation();
  const current = location.pathname;
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (!event.target.closest('.dropdown')) {
        setSettingsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const tabs = [
    { path: '/', label: 'Search', icon: Search },
    { path: '/pipelines', label: 'Pipelines', icon: GitBranch },
    { path: '/patients', label: 'Patients', icon: Users },
    { path: '/molecules', label: 'Molecules', icon: FlaskConical },
    { path: '/upload', label: 'Register', icon: ClipboardList },
  ];

  return (
    <div className="toolbar">
      <div 
        className="toolbar-brand" 
        onClick={() => window.location.href = '/'} 
        style={{ cursor: 'pointer' }}
        title="Go to Search"
      >
        <img src={`${process.env.PUBLIC_URL}/vast_logo.svg`} alt="VAST Data" style={{ height: '18px', objectFit: 'contain' }} />
        <div>
          <h1>VASTRiant</h1>
          <span>Genomic Pipeline</span>
        </div>
      </div>
      <div className="toolbar-nav" style={{ flex: 1 }}>
        {tabs.map(({ path, label, icon: Icon }) => (
          <button
            key={path}
            className={current === path ? 'active' : ''}
            onClick={() => navigate(path)}
          >
            <Icon size={16} /> {label}
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginRight: '16px' }}>
        <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{username}</span>
        <div className={`dropdown ${settingsOpen ? 'open' : ''}`}>
          <button 
            className="btn spin-on-hover" 
            style={{ padding: '6px', background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }} 
            onClick={() => setSettingsOpen(!settingsOpen)} 
            title="Settings"
          >
            <Settings size={16} />
          </button>
          <div className="dropdown-content">
            <button onClick={() => { setSettingsOpen(false); window.dispatchEvent(new CustomEvent('open-diagram')); }}>
              <LayoutTemplate size={16} />
              Genomic Blueprint
            </button>
            {/* Platform Design — temporarily hidden
            <button onClick={() => { setSettingsOpen(false); window.dispatchEvent(new CustomEvent('open-design')); }}>
              <Activity size={16} />
              Platform Design
            </button>
            */}
            <button onClick={() => { setSettingsOpen(false); window.dispatchEvent(new CustomEvent('open-terminology')); }}>
              <BookOpen size={16} />
              Terminology
            </button>
            <button onClick={() => { setSettingsOpen(false); window.dispatchEvent(new CustomEvent('open-about')); }}>
              <Info size={16} />
              About
            </button>
          </div>
        </div>
        <button className="btn" style={{ padding: '6px', background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }} onClick={onLogout} title="Log out">
          <LogOut size={16} />
        </button>
      </div>
    </div>
  );
}

function Footer() {
  return (
    <div style={{ padding: '20px', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px', opacity: 0.7, transition: 'opacity 0.2s ease', marginTop: 'auto' }}>
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
  );
}

// Check for auto-login params before React renders
function checkAutoLogin() {
  const urlParams = new URLSearchParams(window.location.search);
  const token = urlParams.get('token');
  const username = urlParams.get('username');
  
  console.log('[AUTO-LOGIN] Checking URL params:', { token: token ? 'YES' : 'NO', username });
  
  if (token) {
    console.log('[AUTO-LOGIN] Token found, storing in localStorage');
    localStorage.setItem('token', token);
    if (username) {
      localStorage.setItem('username', username);
    }
    // Clear the URL params (keep clean URL)
    window.history.replaceState({}, '', window.location.pathname);
    console.log('[AUTO-LOGIN] Auto-login complete');
    return { token, username };
  }
  return null;
}

// Run auto-login check immediately
const autoLoginResult = checkAutoLogin();

function App() {
  const [token, setToken] = useState(autoLoginResult?.token || localStorage.getItem('token'));
  const [username, setUsername] = useState(autoLoginResult?.username || localStorage.getItem('username'));
  const [showDesign, setShowDesign] = useState(false);
  const [showTerminology, setShowTerminology] = useState(false);
  const [showAbout, setShowAbout] = useState(false);

  useEffect(() => {
    const handleOpenDiagram = () => window.open('/blueprint.html', '_blank');
    const handleOpenDesign = () => setShowDesign(true);
    const handleOpenTerminology = () => setShowTerminology(true);
    const handleOpenAbout = () => setShowAbout(true);
    window.addEventListener('open-diagram', handleOpenDiagram);
    window.addEventListener('open-design', handleOpenDesign);
    window.addEventListener('open-terminology', handleOpenTerminology);
    window.addEventListener('open-about', handleOpenAbout);
    return () => {
      window.removeEventListener('open-diagram', handleOpenDiagram);
      window.removeEventListener('open-design', handleOpenDesign);
      window.removeEventListener('open-terminology', handleOpenTerminology);
      window.removeEventListener('open-about', handleOpenAbout);
    };
  }, []);

  const handleLogin = (newToken, newUsername) => {
    setToken(newToken);
    setUsername(newUsername);
  };

  const handleLogout = () => {
    if (window.confirm('Are you sure you want to log out?')) {
      localStorage.removeItem('token');
      localStorage.removeItem('username');
      setToken(null);
      setUsername(null);
    }
  };

  if (!token) {
    return <LoginPage onLogin={handleLogin} />;
  }

  return (
    <Router>
      <div className="app-layout">
        <NavBar username={username} onLogout={handleLogout} />
        <div className="page">
          <Routes>
            <Route path="/" element={<SearchPage />} />
            <Route path="/pipelines" element={<PipelineDashboard />} />
            <Route path="/pipelines/:name" element={<PipelineDetail />} />
            <Route path="/patients" element={<PatientView />} />
            <Route path="/molecules" element={<MoleculesPage />} />
            <Route path="/upload" element={<UploadPage />} />
          </Routes>
        </div>
        <Footer />
        {showDesign && <PlatformDesign onClose={() => setShowDesign(false)} />}
        {showTerminology && <TerminologyModal onClose={() => setShowTerminology(false)} />}
        {showAbout && <AboutModal onClose={() => setShowAbout(false)} />}
      </div>
    </Router>
  );
}

export default App;
