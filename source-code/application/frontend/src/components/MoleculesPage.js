import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { FlaskConical, Dna, Eye, MessageSquare, Search, Filter, ExternalLink } from 'lucide-react';
import { getAllMolecules, annotateMolecule } from '../services/api';

const Viewer3D = ({ proteinPdb, ligandSdf }) => {
  const containerRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current || (!proteinPdb && !ligandSdf)) return;
    let viewer;
    const init = async () => {
      try {
        const $3Dmol = await import('3dmol');
        viewer = $3Dmol.createViewer(containerRef.current, { backgroundColor: '#0b0c10' });
        if (proteinPdb) {
          viewer.addModel(proteinPdb, 'pdb');
          viewer.setStyle({}, { cartoon: { color: 'spectrum', opacity: 0.7 } });
        }
        if (ligandSdf) {
          viewer.addModel(ligandSdf, 'sdf');
          viewer.setStyle({ model: -1 }, { stick: { colorscheme: 'greenCarbon', radius: 0.15 } });
          viewer.addSurface($3Dmol.SurfaceType.VDW, { opacity: 0.4, color: '#66fcf1' }, { model: -1 });
        }
        viewer.zoomTo();
        viewer.render();
      } catch (e) {
        console.error('3Dmol init failed:', e);
      }
    };
    init();
    return () => { if (viewer) try { viewer.clear(); } catch (_) {} };
  }, [proteinPdb, ligandSdf]);

  return <div ref={containerRef} style={{ width: '100%', height: '280px', borderRadius: '8px', border: '1px solid var(--border-subtle)', position: 'relative' }} />;
};

const getResearcherName = () => {
  let name = localStorage.getItem('researcherName');
  if (!name) {
    name = prompt('Enter your researcher name (for audit trail):');
    if (name) localStorage.setItem('researcherName', name);
  }
  return name || 'Anonymous';
};

const timeAgo = (isoStr) => {
  if (!isoStr) return '';
  const diff = (Date.now() - new Date(isoStr).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
};

const statusColors = {
  generated: { bg: 'rgba(139, 146, 152, 0.15)', color: 'var(--text-muted)' },
  docked: { bg: 'rgba(102, 252, 241, 0.15)', color: 'var(--accent)' },
  testing: { bg: 'rgba(232, 175, 111, 0.15)', color: 'var(--warning)' },
  validated: { bg: 'rgba(84, 231, 222, 0.15)', color: 'var(--success)' },
  rejected: { bg: 'rgba(232, 55, 86, 0.15)', color: 'var(--danger)' },
};

function MoleculesPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [molecules, setMolecules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState([]);
  const [geneFilter, setGeneFilter] = useState('');
  const [searchText, setSearchText] = useState('');
  const [expandedId, setExpandedId] = useState(null);
  const [noteInputs, setNoteInputs] = useState({});
  const [savingNote, setSavingNote] = useState(null);
  const [viewer3dId, setViewer3dId] = useState(null);

  useEffect(() => {
    const gene = searchParams.get('gene');
    const variant = searchParams.get('variant');
    if (gene) setGeneFilter(gene);
    if (variant) setSearchText(variant);
  }, [searchParams]);

  useEffect(() => {
    setLoading(true);
    getAllMolecules()
      .then(({ data }) => setMolecules(data.molecules || []))
      .catch(() => setMolecules([]))
      .finally(() => setLoading(false));
  }, []);

  const handleStatusToggle = (s) => {
    setStatusFilter(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]);
  };

  const handleAddNote = async (mol) => {
    const text = (noteInputs[mol.molecule_id] || '').trim();
    if (!text) return;
    setSavingNote(mol.molecule_id);
    try {
      const researcher = getResearcherName();
      await annotateMolecule(mol.molecule_id, {
        researcher_name: researcher,
        text,
        action: 'note',
        variant_id: mol.variant_id || '',
        gene: mol.gene || '',
      });
      setMolecules(prev => prev.map(m =>
        m.molecule_id === mol.molecule_id
          ? { ...m, annotations: [...(m.annotations || []), { timestamp: new Date().toISOString(), researcher_name: researcher, action: 'note', text }] }
          : m
      ));
      setNoteInputs(prev => ({ ...prev, [mol.molecule_id]: '' }));
    } catch (e) {
      console.error('Annotation failed:', e);
    }
    setSavingNote(null);
  };

  const handleStatusChange = async (mol, newStatus) => {
    const researcher = getResearcherName();
    try {
      await annotateMolecule(mol.molecule_id, {
        researcher_name: researcher,
        text: `Status changed from ${mol.status} to ${newStatus}`,
        action: 'status_change',
        new_status: newStatus,
        variant_id: mol.variant_id || '',
        gene: mol.gene || '',
      });
      setMolecules(prev => prev.map(m =>
        m.molecule_id === mol.molecule_id
          ? { ...m, status: newStatus, annotations: [...(m.annotations || []), { timestamp: new Date().toISOString(), researcher_name: researcher, action: 'status_change', text: `Status: ${mol.status} → ${newStatus}` }] }
          : m
      ));
    } catch (e) {
      console.error('Status change failed:', e);
    }
  };

  const genes = [...new Set(molecules.map(m => m.gene).filter(Boolean))].sort();

  const filtered = molecules.filter(m => {
    if (statusFilter.length > 0 && !statusFilter.includes(m.status)) return false;
    if (geneFilter && m.gene !== geneFilter) return false;
    if (searchText) {
      const q = searchText.toLowerCase();
      const fields = [m.generated_smiles, m.seed_drug_name, m.gene, m.variant_id, m.molecule_id].join(' ').toLowerCase();
      if (!fields.includes(q)) return false;
    }
    return true;
  });

  const grouped = {};
  filtered.forEach(m => {
    const key = `${m.gene || 'Unknown'}::${m.variant_id || 'none'}`;
    if (!grouped[key]) grouped[key] = { gene: m.gene, variant_id: m.variant_id, molecules: [] };
    grouped[key].molecules.push(m);
  });

  const groups = Object.values(grouped).sort((a, b) => b.molecules.length - a.molecules.length);

  const docked = molecules.filter(m => m.docking_pdb_id).length;
  const validated = molecules.filter(m => m.status === 'validated').length;

  return (
    <>
      <div className="card">
        <div className="card-header">
          <h2><FlaskConical size={18} /> Molecule Explorer</h2>
          <div style={{ display: 'flex', gap: '16px', fontSize: '12px', color: 'var(--text-muted)' }}>
            <span>{molecules.length} molecules</span>
            <span>{docked} docked</span>
            <span>{validated} validated</span>
            <span>{genes.length} genes</span>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '12px' }}>
          <div style={{ flex: 1, position: 'relative' }}>
            <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input
              type="text"
              placeholder="Search by SMILES, drug name, gene, variant ID..."
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              style={{ width: '100%', padding: '8px 12px 8px 32px', background: 'var(--bg-input)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)', borderRadius: '6px', fontSize: '12px' }}
            />
          </div>
          <select
            value={geneFilter}
            onChange={(e) => setGeneFilter(e.target.value)}
            style={{ padding: '8px 12px', background: 'var(--bg-input)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)', borderRadius: '6px', fontSize: '12px' }}
          >
            <option value="">All genes</option>
            {genes.map(g => <option key={g} value={g}>{g}</option>)}
          </select>
        </div>

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', fontSize: '12px', color: 'var(--text-muted)', flexWrap: 'wrap' }}>
          <Filter size={14} />
          <strong>Status:</strong>
          {['generated', 'docked', 'testing', 'validated', 'rejected'].map(s => (
            <label key={s} style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
              <input type="checkbox" checked={statusFilter.includes(s)} onChange={() => handleStatusToggle(s)} />
              <span style={{ ...statusColors[s], padding: '1px 6px', borderRadius: '8px', fontSize: '11px', fontWeight: 600, background: statusColors[s].bg, color: statusColors[s].color }}>
                {s}
              </span>
            </label>
          ))}
        </div>
      </div>

      {loading && <div className="spinner" />}

      {!loading && filtered.length === 0 && (
        <div className="empty-state">
          <FlaskConical size={40} />
          <p>{molecules.length === 0 ? 'No molecules generated yet. Use the Drug Discovery panel in Search to generate molecules.' : 'No molecules match the current filters.'}</p>
        </div>
      )}

      {groups.map((group) => (
        <div className="card" key={`${group.gene}-${group.variant_id}`} style={{ marginBottom: '16px' }}>
          <div className="card-header" style={{ marginBottom: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span
                className="gene-badge"
                style={{ cursor: 'pointer' }}
                title={`Search variants for ${group.gene}`}
                onClick={() => navigate(`/?q=${encodeURIComponent(group.gene + ' variants')}&gene=${encodeURIComponent(group.gene)}&nosynth=true`)}
              >
                {group.gene || 'Unknown'} <ExternalLink size={9} style={{ marginLeft: '2px', opacity: 0.6 }} />
              </span>
              <span
                style={{ fontSize: '11px', color: 'var(--accent)', fontFamily: 'monospace', cursor: 'pointer', textDecoration: 'underline', textDecorationStyle: 'dotted', textUnderlineOffset: '3px' }}
                title="View this exact variant"
                onClick={() => navigate(`/?variant_id=${encodeURIComponent(group.variant_id)}`)}
              >
                Variant: {group.variant_id?.substring(0, 16) || 'N/A'}...
                <ExternalLink size={9} style={{ marginLeft: '4px', verticalAlign: 'middle' }} />
              </span>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                {group.molecules.length} molecule{group.molecules.length !== 1 ? 's' : ''}
              </span>
            </div>
          </div>

          {group.molecules.map((m) => {
            const isExpanded = expandedId === m.molecule_id;
            const sc = statusColors[m.status] || statusColors.generated;
            const annotations = m.annotations || [];

            return (
              <div
                key={m.molecule_id}
                className="variant-card"
                style={{ cursor: 'pointer' }}
                onClick={() => setExpandedId(isExpanded ? null : m.molecule_id)}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                  <code
                    style={{ fontSize: '11px', color: 'var(--text-primary)', wordBreak: 'break-all', flex: 1, minWidth: '200px' }}
                    title="Click to copy"
                    onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(m.generated_smiles); }}
                  >
                    {m.generated_smiles}
                  </code>

                  {m.seed_drug_name && (
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)', background: 'var(--bg-card-hover)', padding: '2px 6px', borderRadius: '4px' }}>
                      Seed: {m.seed_drug_name}
                    </span>
                  )}

                  <span style={{
                    padding: '2px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: 600,
                    background: m.tanimoto_score >= 0.5 ? 'rgba(84, 231, 222, 0.15)' : m.tanimoto_score >= 0.2 ? 'rgba(232, 175, 111, 0.15)' : 'rgba(139, 146, 152, 0.15)',
                    color: m.tanimoto_score >= 0.5 ? 'var(--success)' : m.tanimoto_score >= 0.2 ? 'var(--warning)' : 'var(--text-muted)',
                  }}>
                    {((m.tanimoto_score || 0) * 100).toFixed(1)}%
                  </span>

                  {m.docking_pdb_id && (
                    <a
                      href={`https://www.rcsb.org/structure/${m.docking_pdb_id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      style={{ padding: '2px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: 600, background: 'rgba(102, 252, 241, 0.15)', color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: '4px', textDecoration: 'none' }}
                      title="View protein structure on RCSB PDB"
                    >
                      <Dna size={10} /> {m.docking_pdb_id} ({(m.docking_score || 0).toFixed(3)}) <ExternalLink size={9} />
                    </a>
                  )}

                  <span style={{ ...sc, padding: '2px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: 600, background: sc.bg, color: sc.color }}>
                    {m.status}
                  </span>

                  {annotations.length > 0 && (
                    <span style={{ fontSize: '10px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <MessageSquare size={10} /> {annotations.length}
                    </span>
                  )}
                </div>

                {isExpanded && (
                  <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid var(--border-subtle)' }} onClick={(e) => e.stopPropagation()}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', fontSize: '12px', marginBottom: '16px' }}>
                      <div>
                        <span style={{ color: 'var(--text-muted)' }}>Seed SMILES:</span>
                        <div style={{ fontFamily: 'monospace', fontSize: '11px', color: 'var(--accent)', wordBreak: 'break-all', marginTop: '2px' }}>{m.seed_smiles}</div>
                      </div>
                      <div>
                        <span style={{ color: 'var(--text-muted)' }}>Created:</span>
                        <div style={{ color: 'var(--text-primary)', marginTop: '2px' }}>{m.created_at ? new Date(m.created_at).toLocaleString() : 'N/A'}</div>
                      </div>
                      {m.gene && (
                        <div>
                          <span style={{ color: 'var(--text-muted)' }}>Variant:</span>
                          <div
                            style={{ color: 'var(--accent)', marginTop: '2px', cursor: 'pointer', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px' }}
                            onClick={() => navigate(`/?variant_id=${encodeURIComponent(m.variant_id)}`)}
                          >
                            {m.gene} — {m.variant_id?.substring(0, 12)}...
                            <ExternalLink size={10} />
                          </div>
                        </div>
                      )}
                    </div>

                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '12px' }}>
                      <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Status:</span>
                      <select
                        value={m.status}
                        onChange={(e) => handleStatusChange(m, e.target.value)}
                        style={{ padding: '4px 8px', background: 'var(--bg-input)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)', borderRadius: '4px', fontSize: '11px' }}
                      >
                        {['generated', 'docked', 'testing', 'validated', 'rejected'].map(s => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                    </div>

                    <div style={{ display: 'flex', gap: '6px', marginBottom: '12px' }}>
                      <input
                        type="text"
                        placeholder="Add a note..."
                        value={noteInputs[m.molecule_id] || ''}
                        onChange={(e) => setNoteInputs(prev => ({ ...prev, [m.molecule_id]: e.target.value }))}
                        onKeyDown={(e) => e.key === 'Enter' && handleAddNote(m)}
                        style={{ flex: 1, padding: '6px 10px', background: 'var(--bg-input)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)', borderRadius: '4px', fontSize: '11px' }}
                      />
                      <button
                        onClick={() => handleAddNote(m)}
                        disabled={savingNote === m.molecule_id || !(noteInputs[m.molecule_id] || '').trim()}
                        style={{ fontSize: '11px', padding: '6px 12px', background: 'var(--accent)', color: '#0b0c10', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 600 }}
                      >
                        {savingNote === m.molecule_id ? '...' : 'Save'}
                      </button>
                    </div>

                    {annotations.length > 0 && (
                      <div style={{ maxHeight: '150px', overflowY: 'auto', paddingLeft: '8px', borderLeft: '2px solid var(--border-subtle)', marginBottom: '12px' }}>
                        {annotations.map((a, i) => (
                          <div key={i} style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: '4px', lineHeight: 1.4 }}>
                            <span style={{ color: a.action === 'note' ? 'var(--accent)' : a.action === 'status_change' ? 'var(--warning)' : 'var(--success)', fontWeight: 600 }}>
                              {a.action === 'note' ? '💬' : a.action === 'status_change' ? '🔄' : '🧪'}
                            </span>{' '}
                            <span style={{ color: 'var(--text-secondary)' }}>{a.researcher_name}</span>{' '}
                            <span>{a.text}</span>{' '}
                            <span style={{ opacity: 0.6 }}>{timeAgo(a.timestamp)}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {m.docking_pdb_id && (
                      <div>
                        <div
                          style={{ fontSize: '12px', color: 'var(--accent)', marginBottom: '8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}
                          onClick={() => setViewer3dId(viewer3dId === m.molecule_id ? null : m.molecule_id)}
                        >
                          <Eye size={12} />
                          {viewer3dId === m.molecule_id ? 'Hide' : 'Show'} 3D Docking View — {m.docking_pdb_id} (confidence: {(m.docking_score || 0).toFixed(3)})
                        </div>
                        {viewer3dId === m.molecule_id && m.docking_poses_sdf && (
                          <Viewer3D proteinPdb={m.protein_pdb_content} ligandSdf={m.docking_poses_sdf} />
                        )}
                        {viewer3dId === m.molecule_id && !m.docking_poses_sdf && (
                          <div style={{ fontSize: '11px', color: 'var(--text-muted)', padding: '12px', background: 'var(--bg-card-hover)', borderRadius: '8px' }}>
                            Docking was recorded but 3D pose data is not available.
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </>
  );
}

export default MoleculesPage;
