import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Search, Sparkles, Database, ChevronDown, ChevronUp, Loader, BarChart2, Users, Dna, Zap, Clock, Anchor, MessageSquare, FlaskConical, Eye, ExternalLink, RefreshCw } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { searchVariants, synthesizeSearch, getVariantById, explainVariant, getInsights, getPatient, getStats, generateMolecules, lookupStructures, dockMolecule, getVariantMolecules, getMoleculeDockingBlobs, annotateMolecule } from '../services/api';

const Viewer3D = ({ proteinPdb, ligandSdf }) => {
  const containerRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current || (!proteinPdb && !ligandSdf)) return;
    let viewer;
    const init = async () => {
      try {
        const $3Dmol = await import('3dmol');
        viewer = $3Dmol.createViewer(containerRef.current, {
          backgroundColor: '#0b0c10',
        });
        if (proteinPdb) {
          viewer.addModel(proteinPdb, 'pdb');
          viewer.setStyle({}, { cartoon: { color: 'spectrum', opacity: 0.7 } });
        }
        if (ligandSdf) {
          viewer.addModel(ligandSdf, 'sdf');
          viewer.setStyle({ model: -1 }, { stick: { colorscheme: 'greenCarbon', radius: 0.15 } });
          viewer.addSurface(
            $3Dmol.SurfaceType.VDW,
            { opacity: 0.4, color: '#66fcf1' },
            { model: -1 }
          );
        }
        viewer.zoomTo();
        viewer.render();
      } catch (e) {
        console.error('3Dmol init failed:', e);
      }
    };
    init();
    return () => {
      if (viewer) {
        try { viewer.clear(); } catch (_) {}
      }
    };
  }, [proteinPdb, ligandSdf]);

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '320px', borderRadius: '8px', border: '1px solid var(--border-subtle)', position: 'relative' }}
    />
  );
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

const MoleculeAnnotations = ({ molecule }) => {
  const [showForm, setShowForm] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [saving, setSaving] = useState(false);
  const [localAnnotations, setLocalAnnotations] = useState(molecule.annotations || []);
  const [localStatus, setLocalStatus] = useState(molecule.status || 'generated');

  const handleAddNote = async () => {
    if (!noteText.trim()) return;
    setSaving(true);
    try {
      const researcher = getResearcherName();
      await annotateMolecule(molecule.molecule_id, {
        researcher_name: researcher,
        text: noteText.trim(),
        action: 'note',
        variant_id: molecule.variant_id || '',
        gene: molecule.gene || '',
      });
      setLocalAnnotations(prev => [...prev, {
        timestamp: new Date().toISOString(),
        researcher_name: researcher,
        action: 'note',
        text: noteText.trim(),
      }]);
      setNoteText('');
      setShowForm(false);
    } catch (e) {
      console.error('Annotation failed:', e);
    }
    setSaving(false);
  };

  const handleStatusChange = async (newStatus) => {
    const researcher = getResearcherName();
    try {
      await annotateMolecule(molecule.molecule_id, {
        researcher_name: researcher,
        text: `Status changed from ${localStatus} to ${newStatus}`,
        action: 'status_change',
        new_status: newStatus,
        variant_id: molecule.variant_id || '',
        gene: molecule.gene || '',
      });
      setLocalAnnotations(prev => [...prev, {
        timestamp: new Date().toISOString(),
        researcher_name: researcher,
        action: 'status_change',
        text: `Status: ${localStatus} → ${newStatus}`,
        previous_status: localStatus,
        new_status: newStatus,
      }]);
      setLocalStatus(newStatus);
    } catch (e) {
      console.error('Status change failed:', e);
    }
  };

  const actionColors = { note: 'var(--accent)', status_change: 'var(--warning)', docking_run: 'var(--success)' };

  return (
    <div style={{ marginTop: '8px' }}>
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '8px' }}>
        <select
          value={localStatus}
          onChange={(e) => handleStatusChange(e.target.value)}
          style={{ padding: '4px 8px', background: 'var(--bg-input)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)', borderRadius: '4px', fontSize: '11px' }}
        >
          {['generated', 'docked', 'testing', 'validated', 'rejected'].map(s => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <button
          onClick={() => setShowForm(!showForm)}
          style={{ fontSize: '11px', padding: '4px 8px', background: 'transparent', border: '1px solid var(--border-subtle)', color: 'var(--accent)', borderRadius: '4px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
        >
          <MessageSquare size={12} /> Add Note
        </button>
      </div>

      {showForm && (
        <div style={{ display: 'flex', gap: '6px', marginBottom: '8px' }}>
          <input
            type="text"
            placeholder="Type your note..."
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddNote()}
            style={{ flex: 1, padding: '6px 10px', background: 'var(--bg-input)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)', borderRadius: '4px', fontSize: '11px' }}
          />
          <button
            onClick={handleAddNote}
            disabled={saving || !noteText.trim()}
            style={{ fontSize: '11px', padding: '6px 12px', background: 'var(--accent)', color: '#0b0c10', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 600 }}
          >
            {saving ? '...' : 'Save'}
          </button>
        </div>
      )}

      {localAnnotations.length > 0 && (
        <div style={{ maxHeight: '120px', overflowY: 'auto', paddingLeft: '8px', borderLeft: '2px solid var(--border-subtle)' }}>
          {localAnnotations.map((a, i) => (
            <div key={i} style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: '4px', lineHeight: 1.4 }}>
              <span style={{ color: actionColors[a.action] || 'var(--text-muted)', fontWeight: 600 }}>
                {a.action === 'note' ? '💬' : a.action === 'status_change' ? '🔄' : '🧪'}
              </span>{' '}
              <span style={{ color: 'var(--text-secondary)' }}>{a.researcher_name}</span>{' '}
              <span>{a.text}</span>{' '}
              <span style={{ opacity: 0.6 }}>{timeAgo(a.timestamp)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const DrugDiscoveryPanel = ({ drugRecommendations, gene, variantId }) => {
  const navigate = useNavigate();
  const [selectedDrug, setSelectedDrug] = useState('');
  const [customSmiles, setCustomSmiles] = useState('');
  const [useCustom, setUseCustom] = useState(false);
  const [molResult, setMolResult] = useState(null);
  const [molLoading, setMolLoading] = useState(false);
  const [molError, setMolError] = useState(null);

  const [structures, setStructures] = useState([]);
  const [structuresLoading, setStructuresLoading] = useState(false);
  const [selectedPdb, setSelectedPdb] = useState('');
  const [customPdb, setCustomPdb] = useState('');
  const [usePdbManual, setUsePdbManual] = useState(false);

  const [dockingStates, setDockingStates] = useState({});
  const [viewerMolIdx, setViewerMolIdx] = useState(null);
  const [viewerLoadingIdx, setViewerLoadingIdx] = useState(null);
  const [savedLoading, setSavedLoading] = useState(false);

  const handleToggleViewer = async (idx) => {
    if (viewerMolIdx === idx) {
      setViewerMolIdx(null);
      return;
    }
    const ds = dockingStates[idx];
    if (!ds?.result) return;
    setViewerMolIdx(idx);
    if (ds.result.best_pose_sdf) return;
    const moleculeId = ds.result.molecule_id;
    if (!moleculeId) return;
    setViewerLoadingIdx(idx);
    try {
      const { data } = await getMoleculeDockingBlobs(moleculeId);
      setDockingStates(prev => ({
        ...prev,
        [idx]: {
          ...prev[idx],
          result: {
            ...prev[idx].result,
            best_pose_sdf: data.best_pose_sdf || '',
            protein_pdb: data.protein_pdb || '',
          },
        },
      }));
    } catch (err) {
      const detail = err.response?.data?.detail || err.message || 'Failed to load 3D pose data';
      setDockingStates(prev => ({
        ...prev,
        [idx]: { ...prev[idx], blobError: detail },
      }));
    } finally {
      setViewerLoadingIdx(null);
    }
  };

  useEffect(() => {
    if (!gene) return;
    setStructuresLoading(true);
    lookupStructures(gene)
      .then(({ data }) => {
        const found = data.structures || [];
        setStructures(found);
        if (found.length > 0) {
          setSelectedPdb(found[0].pdb_id);
        } else {
          setUsePdbManual(true);
        }
      })
      .catch(() => {})
      .finally(() => setStructuresLoading(false));
  }, [gene]);

  useEffect(() => {
    if (!variantId) return;
    setSavedLoading(true);
    getVariantMolecules(variantId)
      .then(({ data }) => {
        const mols = data.molecules || [];
        if (mols.length === 0) return;

        const formatted = mols.map((m) => ({
          sample: m.generated_smiles,
          score: m.tanimoto_score || 0,
          molecule_id: m.molecule_id,
          variant_id: m.variant_id,
          gene: m.gene,
          status: m.status,
          annotations: m.annotations || [],
          _docking_pdb_id: m.docking_pdb_id || '',
          _docking_score: m.docking_score,
          _docking_poses_json: m.docking_poses_json || '[]',
          _docking_poses_sdf: m.docking_poses_sdf || '',
          _protein_pdb_content: m.protein_pdb_content || '',
        }));

        formatted.sort((a, b) => (b.score || 0) - (a.score || 0));

        const initialDockStates = {};
        formatted.forEach((m, idx) => {
          if (m._docking_pdb_id) {
            let posesCount = 0;
            try { posesCount = JSON.parse(m._docking_poses_json).length; } catch (_) {}
            initialDockStates[idx] = {
              loading: false,
              result: {
                molecule_id: m.molecule_id,
                pdb_id: m._docking_pdb_id,
                docking_score: m._docking_score || 0,
                poses_count: posesCount,
                best_pose_sdf: m._docking_poses_sdf,
                protein_pdb: m._protein_pdb_content,
                source: 'cached',
              },
            };
          }
        });

        setMolResult({
          seed_smiles: mols[0]?.seed_smiles || '',
          drug_name: mols[0]?.seed_drug_name || null,
          molecules: formatted,
          score_type: 'tanimoto_similarity',
          source: 'cached',
        });
        setDockingStates(initialDockStates);
      })
      .catch(() => {})
      .finally(() => setSavedLoading(false));
  }, [variantId]);

  const handleGenerate = async () => {
    const params = useCustom
      ? { smiles: customSmiles.trim(), gene: gene || '', variant_id: variantId || '' }
      : { drug_name: selectedDrug, gene: gene || '', variant_id: variantId || '' };

    if (!params.smiles && !params.drug_name) return;

    setMolLoading(true);
    setMolError(null);
    setMolResult(null);
    setDockingStates({});
    try {
      const { data } = await generateMolecules(params);
      setMolResult(data);

      if (data.molecules) {
        const newDockStates = {};
        data.molecules.forEach((m, idx) => {
          if (m.docking_pdb_id) {
            let posesCount = 0;
            try { posesCount = JSON.parse(m.docking_poses_json || '[]').length; } catch (_) {}
            newDockStates[idx] = {
              loading: false,
              result: {
                molecule_id: m.molecule_id,
                pdb_id: m.docking_pdb_id,
                docking_score: m.docking_score || 0,
                poses_count: posesCount,
                best_pose_sdf: m.docking_poses_sdf || '',
                protein_pdb: m.protein_pdb_content || '',
                source: 'cached',
              },
            };
          }
        });
        if (Object.keys(newDockStates).length > 0) setDockingStates(newDockStates);
      }
    } catch (err) {
      const detail = err.response?.data?.detail || err.message || 'MolMIM generation failed';
      setMolError(detail);
    }
    setMolLoading(false);
  };

  const activePdb = usePdbManual ? customPdb.trim().toUpperCase() : selectedPdb;

  const handleDock = async (mol, idx) => {
    if (!activePdb) return;
    const smiles = mol.sample || mol.generated_smiles;
    const moleculeId = mol.molecule_id;

    setDockingStates(prev => ({ ...prev, [idx]: { loading: true } }));
    try {
      const researcher = getResearcherName();
      const { data } = await dockMolecule({
        molecule_id: moleculeId,
        pdb_id: activePdb,
        num_poses: 5,
        researcher_name: researcher,
      });
      setDockingStates(prev => ({ ...prev, [idx]: { loading: false, result: data } }));
    } catch (err) {
      const detail = err.response?.data?.detail || err.message || 'Docking failed';
      setDockingStates(prev => ({ ...prev, [idx]: { loading: false, error: detail } }));
    }
  };

  return (
    <div style={{ marginTop: '20px', border: '1px solid var(--accent)', borderRadius: '8px', padding: '16px', background: 'rgba(102, 252, 241, 0.03)' }}>
      <h4 style={{ color: 'var(--accent)', marginBottom: '12px', fontSize: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
        <Dna size={16} /> NVIDIA BioNeMo Drug Discovery
      </h4>
      <p style={{ color: 'var(--text-muted)', fontSize: '12px', marginBottom: '16px', lineHeight: 1.5 }}>
        Generate novel candidate molecules using NVIDIA MolMIM, then dock against protein structures with DiffDock.
        MolMIM works with small-molecule compounds only (not biologics such as antibodies).
      </p>

      {savedLoading && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--accent)', fontSize: '12px', marginBottom: '12px' }}>
          <Loader size={14} style={{ animation: 'spin 1s linear infinite' }} /> Loading previously saved molecules...
        </div>
      )}

      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '12px', fontSize: '12px' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer', color: 'var(--text-muted)' }}>
          <input type="radio" checked={!useCustom} onChange={() => setUseCustom(false)} />
          Seed from drug
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer', color: 'var(--text-muted)' }}>
          <input type="radio" checked={useCustom} onChange={() => setUseCustom(true)} />
          Custom SMILES
        </label>
      </div>

      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '16px' }}>
        {!useCustom ? (
          <select
            value={selectedDrug}
            onChange={(e) => setSelectedDrug(e.target.value)}
            style={{ flex: 1, padding: '8px 12px', background: 'var(--bg-input)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)', borderRadius: '6px', fontSize: '12px' }}
          >
            <option value="">Select a drug as seed molecule...</option>
            {(drugRecommendations || []).map((d, i) => (
              <option key={i} value={d.drug}>{d.drug} ({d.indication})</option>
            ))}
          </select>
        ) : (
          <input
            type="text"
            placeholder="Paste SMILES string (e.g. CC(=O)Oc1ccccc1C(=O)O)"
            value={customSmiles}
            onChange={(e) => setCustomSmiles(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleGenerate()}
            style={{ flex: 1, padding: '8px 12px', background: 'var(--bg-input)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)', borderRadius: '6px', fontSize: '12px', fontFamily: 'monospace' }}
          />
        )}
        <button
          className="btn btn-primary"
          onClick={handleGenerate}
          disabled={molLoading || (!useCustom && !selectedDrug) || (useCustom && !customSmiles.trim())}
          style={{ fontSize: '12px', padding: '8px 16px', whiteSpace: 'nowrap' }}
        >
          {molLoading ? (
            <><Loader size={14} style={{ animation: 'spin 1s linear infinite' }} /> Generating...</>
          ) : (
            <><Dna size={14} /> Generate Novel Molecules</>
          )}
        </button>
      </div>

      {molError && (
        <div style={{ color: 'var(--danger)', fontSize: '12px', marginBottom: '12px', padding: '8px 12px', background: 'rgba(232, 55, 86, 0.1)', borderRadius: '6px' }}>
          {molError}
        </div>
      )}

      {molResult && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px', padding: '10px 12px', background: 'var(--bg-card-hover)', borderRadius: '6px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Seed:</span>
            {molResult.drug_name && (
              <span style={{ fontSize: '12px', color: 'var(--text-primary)', fontWeight: 600 }}>{molResult.drug_name}</span>
            )}
            <code style={{ fontSize: '11px', color: 'var(--accent)', background: 'rgba(102, 252, 241, 0.08)', padding: '2px 6px', borderRadius: '4px', wordBreak: 'break-all' }}>
              {molResult.seed_smiles}
            </code>
            {molResult.source === 'cached' && (
              <span style={{ fontSize: '10px', background: 'rgba(102, 252, 241, 0.15)', color: 'var(--accent)', padding: '2px 8px', borderRadius: '12px', fontWeight: 600 }}>
                <Database size={10} /> Cached
              </span>
            )}
          </div>

          <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>{molResult.molecules.length} novel molecules generated (scored by {molResult.score_type.replace(/_/g, ' ')})</span>
            {gene && (
              <span
                style={{ fontSize: '11px', color: 'var(--accent)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
                onClick={() => navigate(`/molecules?gene=${encodeURIComponent(gene)}`)}
              >
                <FlaskConical size={11} /> Molecule Explorer <ExternalLink size={10} />
              </span>
            )}
          </div>

          <div style={{ marginBottom: '16px', padding: '12px', background: 'var(--bg-card-hover)', borderRadius: '8px' }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Anchor size={14} /> Protein Target for Docking (DiffDock)
            </div>
            <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: '10px', lineHeight: 1.5 }}>
              Docking simulates how a molecule binds to a protein's 3D structure. Select a protein below, or enter a
              {' '}<a href="https://www.rcsb.org" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }}>RCSB PDB</a> ID manually.
              {!structuresLoading && structures.length === 0 && (
                <span style={{ color: 'var(--warning)', fontWeight: 600 }}>
                  {' '}No protein structures were found for {gene} — this may be a non-coding gene (e.g. antisense RNA)
                  that does not encode a protein. You can still dock against a related protein if you know its PDB ID.
                </span>
              )}
            </div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '8px', fontSize: '11px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer', color: 'var(--text-muted)' }}>
                <input type="radio" checked={!usePdbManual} onChange={() => setUsePdbManual(false)} />
                From gene lookup {structures.length > 0 ? `(${structures.length})` : ''}
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer', color: 'var(--text-muted)' }}>
                <input type="radio" checked={usePdbManual} onChange={() => setUsePdbManual(true)} />
                Manual PDB ID
              </label>
            </div>
            {!usePdbManual ? (
              <select
                value={selectedPdb}
                onChange={(e) => setSelectedPdb(e.target.value)}
                disabled={structuresLoading}
                style={{ width: '100%', padding: '6px 10px', background: 'var(--bg-input)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)', borderRadius: '4px', fontSize: '11px' }}
              >
                {structuresLoading && <option>Loading structures...</option>}
                {!structuresLoading && structures.length === 0 && <option value="">No structures found — switch to Manual PDB ID</option>}
                {structures.map((s) => (
                  <option key={s.pdb_id} value={s.pdb_id}>
                    {s.pdb_id} — {s.method}{s.resolution ? ` (${s.resolution}Å)` : ''}{s.title ? ` — ${s.title.substring(0, 60)}` : ''}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                placeholder="Enter PDB ID (e.g. 5FTK)"
                value={customPdb}
                onChange={(e) => setCustomPdb(e.target.value)}
                style={{ width: '100%', padding: '6px 10px', background: 'var(--bg-input)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)', borderRadius: '4px', fontSize: '11px', fontFamily: 'monospace' }}
              />
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {molResult.molecules.map((m, idx) => {
              const ds = dockingStates[idx];
              const showViewer = viewerMolIdx === idx && ds?.result;
              return (
                <div key={idx} style={{ border: '1px solid var(--border-subtle)', borderRadius: '8px', padding: '12px', background: 'var(--bg-card)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '12px', color: 'var(--text-muted)', width: '24px' }}>{idx + 1}</span>
                    <code
                      style={{ fontSize: '11px', color: 'var(--text-primary)', cursor: 'pointer', wordBreak: 'break-all', flex: 1 }}
                      title="Click to copy"
                      onClick={() => navigator.clipboard.writeText(m.sample || m.generated_smiles)}
                    >
                      {m.sample || m.generated_smiles}
                    </code>
                    <span style={{
                      padding: '2px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: 600,
                      background: m.score >= 0.5 ? 'rgba(84, 231, 222, 0.15)' : m.score >= 0.2 ? 'rgba(232, 175, 111, 0.15)' : 'rgba(139, 146, 152, 0.15)',
                      color: m.score >= 0.5 ? 'var(--success)' : m.score >= 0.2 ? 'var(--warning)' : 'var(--text-muted)',
                    }}>
                      {(m.score * 100).toFixed(1)}%
                    </span>

                    {ds?.result && (
                      <a
                        href={`https://www.rcsb.org/structure/${ds.result.pdb_id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ padding: '2px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: 600, background: 'rgba(102, 252, 241, 0.15)', color: 'var(--accent)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                        title={`View ${ds.result.pdb_id} on RCSB PDB`}
                      >
                        <FlaskConical size={10} /> Dock: {ds.result.docking_score.toFixed(3)} ({ds.result.poses_count} poses) <ExternalLink size={9} />
                      </a>
                    )}

                    <div style={{ display: 'flex', gap: '4px' }}>
                      {!ds?.result && (() => {
                        const dockDisabled = ds?.loading || !activePdb || !m.molecule_id;
                        return (
                          <button
                            onClick={() => handleDock(m, idx)}
                            disabled={dockDisabled}
                            title={!m.molecule_id ? 'Save molecules first (re-generate with variant context)' : !activePdb ? 'Select a PDB structure above or enter one manually' : 'Dock with DiffDock'}
                            style={{
                              fontSize: '10px', padding: '3px 8px', borderRadius: '4px', display: 'flex', alignItems: 'center', gap: '4px',
                              background: 'transparent',
                              border: `1px solid ${dockDisabled ? 'var(--border-subtle)' : 'var(--accent)'}`,
                              color: dockDisabled ? 'var(--text-muted)' : 'var(--accent)',
                              cursor: dockDisabled ? 'not-allowed' : 'pointer',
                              opacity: dockDisabled ? 0.5 : 1,
                            }}
                          >
                            {ds?.loading ? <Loader size={10} style={{ animation: 'spin 1s linear infinite' }} /> : <Anchor size={10} />}
                            {ds?.loading ? 'Docking...' : !activePdb ? 'Select PDB' : 'Dock'}
                          </button>
                        );
                      })()}
                      {ds?.result && (
                        <button
                          onClick={() => handleToggleViewer(idx)}
                          style={{ fontSize: '10px', padding: '3px 8px', background: showViewer ? 'var(--accent)' : 'transparent', border: '1px solid var(--accent)', color: showViewer ? '#0b0c10' : 'var(--accent)', borderRadius: '4px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
                        >
                          <Eye size={10} /> {showViewer ? 'Hide 3D' : 'View 3D'}
                        </button>
                      )}
                    </div>
                  </div>

                  {ds?.error && (
                    <div style={{ color: 'var(--danger)', fontSize: '11px', marginTop: '6px' }}>{ds.error}</div>
                  )}

                  {showViewer && viewerLoadingIdx === idx && (
                    <div style={{ marginTop: '12px', fontSize: '11px', color: 'var(--text-muted)', padding: '12px', background: 'var(--bg-card-hover)', borderRadius: '8px' }}>
                      Loading 3D pose data...
                    </div>
                  )}

                  {showViewer && viewerLoadingIdx !== idx && ds?.blobError && (
                    <div style={{ marginTop: '12px', fontSize: '11px', color: 'var(--danger)', padding: '12px', background: 'var(--bg-card-hover)', borderRadius: '8px' }}>
                      {ds.blobError}
                    </div>
                  )}

                  {showViewer && viewerLoadingIdx !== idx && !ds?.blobError && ds?.result?.best_pose_sdf && (
                    <div style={{ marginTop: '12px' }}>
                      <Viewer3D proteinPdb={ds.result.protein_pdb} ligandSdf={ds.result.best_pose_sdf} />
                      <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '4px', textAlign: 'center' }}>
                        Protein: <a href={`https://www.rcsb.org/structure/${ds.result.pdb_id}`} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }}>{ds.result.pdb_id}</a> | Confidence: {ds.result.docking_score.toFixed(3)} | {ds.result.source === 'cached' ? '(cached)' : '(computed)'}
                      </div>
                    </div>
                  )}

                  {m.molecule_id && <MoleculeAnnotations molecule={m} />}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

const InsightsRenderer = ({ dataRaw, gene, variantId }) => {
  let data;
  try {
    let cleanRaw = dataRaw;
    if (typeof dataRaw === 'string') {
      cleanRaw = dataRaw.replace(/```json\n?/g, '').replace(/\n?```/g, '').trim();
      const jsonStart = cleanRaw.indexOf('{');
      const jsonEnd = cleanRaw.lastIndexOf('}');
      if (jsonStart >= 0 && jsonEnd > jsonStart) {
        cleanRaw = cleanRaw.substring(jsonStart, jsonEnd + 1);
      }
    }
    data = typeof cleanRaw === 'string' ? JSON.parse(cleanRaw) : cleanRaw;
  } catch (e) {
    return (
      <div className="markdown-body" style={{ fontSize: '13px' }}>
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{dataRaw}</ReactMarkdown>
      </div>
    );
  }

  if (data.error) {
    return <div style={{ color: 'var(--danger)' }}>{data.error}</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ background: 'var(--bg-card-hover)', padding: '16px', borderRadius: '8px' }}>
        <h4 style={{ color: 'var(--text-primary)', marginBottom: '8px', fontSize: '14px' }}>Clinical Summary</h4>
        <p style={{ color: 'var(--text-secondary)', fontSize: '13px', lineHeight: 1.5 }}>
          {data.clinical_summary}
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '20px' }}>
        {data.ethnicities && data.ethnicities.length > 0 && (
          <div style={{ border: '1px solid var(--border-subtle)', padding: '16px', borderRadius: '8px' }}>
            <h4 style={{ color: 'var(--text-primary)', marginBottom: '16px', fontSize: '14px', textAlign: 'center' }}>Ethnicity Distribution (%)</h4>
            <div style={{ height: 200 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.ethnicities} layout="vertical" margin={{ left: 40, right: 20, top: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" horizontal={false} />
                  <XAxis type="number" stroke="var(--text-muted)" fontSize={11} domain={[0, 'dataMax + 1']} />
                  <YAxis dataKey="name" type="category" stroke="var(--text-muted)" fontSize={11} width={80} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: 'var(--bg-nav)', border: '1px solid var(--border)', borderRadius: '4px', fontSize: '12px' }}
                    itemStyle={{ color: 'var(--accent)' }}
                  />
                  <Bar dataKey="frequency_pct" fill="var(--accent)" radius={[0, 4, 4, 0]} barSize={20} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {data.age_groups && data.age_groups.length > 0 && (
          <div style={{ border: '1px solid var(--border-subtle)', padding: '16px', borderRadius: '8px' }}>
            <h4 style={{ color: 'var(--text-primary)', marginBottom: '16px', fontSize: '14px', textAlign: 'center' }}>Age Demographics (%)</h4>
            <div style={{ height: 200 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.age_groups} margin={{ left: 0, right: 0, top: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
                  <XAxis dataKey="group" stroke="var(--text-muted)" fontSize={11} />
                  <YAxis stroke="var(--text-muted)" fontSize={11} domain={[0, 'dataMax + 1']} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: 'var(--bg-nav)', border: '1px solid var(--border)', borderRadius: '4px', fontSize: '12px' }}
                    itemStyle={{ color: 'var(--success)' }}
                    cursor={{ fill: 'var(--bg-card-hover)' }}
                  />
                  <Bar dataKey="frequency_pct" fill="var(--success)" radius={[4, 4, 0, 0]} barSize={30} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
        <div style={{ border: '1px solid var(--border-subtle)', padding: '16px', borderRadius: '8px', textAlign: 'center' }}>
          <h4 style={{ color: 'var(--text-primary)', marginBottom: '8px', fontSize: '14px' }}>Likelihood of Disease Evolvement</h4>
          <div style={{ fontSize: '28px', fontWeight: 'bold', color: 'var(--warning)', marginTop: '16px' }}>
            {data.likelihood_of_disease_evolvement_pct !== undefined ? `${data.likelihood_of_disease_evolvement_pct}%` : 'N/A'}
          </div>
        </div>
        
        <div style={{ border: '1px solid var(--border-subtle)', padding: '16px', borderRadius: '8px', textAlign: 'center' }}>
          <h4 style={{ color: 'var(--text-primary)', marginBottom: '8px', fontSize: '14px' }}>Mortality Risk Indicator</h4>
          <div style={{ fontSize: '28px', fontWeight: 'bold', color: 'var(--danger)', marginTop: '16px' }}>
            {data.mortality_risk_pct !== undefined ? `${data.mortality_risk_pct}%` : 'N/A'}
          </div>
        </div>
      </div>

      {data.drug_recommendations && data.drug_recommendations.length > 0 && (
        <div style={{ marginTop: '8px' }}>
          <h4 style={{ color: 'var(--text-primary)', marginBottom: '12px', fontSize: '14px' }}>Drug Recommendations</h4>
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Drug</th>
                  <th>Indication</th>
                  <th>Evidence Level</th>
                </tr>
              </thead>
              <tbody>
                {data.drug_recommendations.map((d, idx) => (
                  <tr key={idx}>
                    <td style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{d.drug}</td>
                    <td>{d.indication}</td>
                    <td>
                      <span style={{
                        padding: '2px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: 600,
                        background: d.evidence_level?.toLowerCase() === 'high' ? 'rgba(84, 231, 222, 0.15)' : 
                                  d.evidence_level?.toLowerCase() === 'moderate' ? 'rgba(232, 175, 111, 0.15)' : 
                                  'rgba(139, 146, 152, 0.15)',
                        color: d.evidence_level?.toLowerCase() === 'high' ? 'var(--success)' : 
                               d.evidence_level?.toLowerCase() === 'moderate' ? 'var(--warning)' : 
                               'var(--text-muted)'
                      }}>
                        {d.evidence_level}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <DrugDiscoveryPanel drugRecommendations={data.drug_recommendations} gene={gene} variantId={variantId} />
    </div>
  );
};

function SearchPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [synthesis, setSynthesis] = useState(null);
  const [loading, setLoading] = useState(false);
  const [synthLoading, setSynthLoading] = useState(false);
  const [searchError, setSearchError] = useState(null);
  const [synthError, setSynthError] = useState(null);
  const [geneFilter, setGeneFilter] = useState('');
  const [qualityFilter, setQualityFilter] = useState('');
  const [patientFilter, setPatientFilter] = useState('');
  const [sigFilter, setSigFilter] = useState([]);
  const [doSynthesize, setDoSynthesize] = useState(true);

  const handleSigToggle = (sig) => {
    setSigFilter(prev => prev.includes(sig) ? prev.filter(s => s !== sig) : [...prev, sig]);
  };
  
  const [expandedId, setExpandedId] = useState(null);
  const [explanation, setExplanation] = useState({});
  const [explainingId, setExplainingId] = useState(null);
  const [insights, setInsights] = useState({});
  const [fetchingInsightsId, setFetchingInsightsId] = useState(null);
  const [patientData, setPatientData] = useState(null);
  const [stats, setStats] = useState(null);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const { data } = await getStats();
        setStats(data);
      } catch (e) {
        console.error("Failed to load stats", e);
      }
    };
    fetchStats();
  }, []);

  const performSearch = async (q, pFilter, synthesizeFlag, sigOverride, geneOverride) => {
    if (!q.trim()) return;
    setLoading(true);
    setSynthesis(null);
    setSynthError(null);
    setSearchError(null);
    setPatientData(null);
    const activeSigFilter = sigOverride !== undefined ? sigOverride : sigFilter;
    const activeGene = geneOverride !== undefined ? geneOverride : geneFilter;

    let uniqueResults = [];
    try {
      const { data } = await searchVariants({
        query: q,
        limit: 40,
        gene: activeGene || null,
        quality: qualityFilter || null,
        patient_id: pFilter || null,
        clinical_significance: activeSigFilter.length > 0 ? activeSigFilter : null,
        synthesize: false,
      });

      const deduped = {};
      for (const v of (data.results || [])) {
        const key = `${v.chromosome}:${v.position}:${v.ref_allele}:${v.alt_allele}`;
        const existing = deduped[key];
        if (!existing || (v.similarity_score || 0) > (existing.similarity_score || 0)) {
          deduped[key] = {
            ...v,
            _seen_count: (existing?._seen_count || 0) + 1,
            cache_hits_count: (existing?.cache_hits_count || 0) + (v.cache_hits_count || 0),
          };
        } else {
          existing._seen_count = (existing._seen_count || 1) + 1;
          existing.cache_hits_count = (existing.cache_hits_count || 0) + (v.cache_hits_count || 0);
        }
      }
      uniqueResults = Object.values(deduped);
      setResults(uniqueResults);

      if (pFilter) {
        try {
          const { data: pData } = await getPatient(pFilter);
          setPatientData(pData.demographics || null);
        } catch (e) {
          console.error("Patient not found", e);
        }
      }
    } catch (err) {
      const detail = err.response?.data?.detail || err.message || 'Search failed';
      setSearchError(detail);
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(false);

    if (synthesizeFlag && uniqueResults.length > 0) {
      setSynthLoading(true);
      try {
        const { data } = await synthesizeSearch({
          query: q,
          variants: uniqueResults,
          patient_id: pFilter || null,
          quality: qualityFilter || null,
        });
        setSynthesis(data.synthesis || null);
      } catch (err) {
        const detail = err.response?.data?.detail || err.message || 'LLM synthesis failed';
        setSynthError(detail);
      } finally {
        setSynthLoading(false);
      }
    }
  };

  const handleSearch = () => performSearch(query, patientFilter, doSynthesize);

  useEffect(() => {
    const q = searchParams.get('q');
    const p = searchParams.get('patient');
    const g = searchParams.get('gene');
    const sig = searchParams.get('sig');
    const nosynth = searchParams.get('nosynth') === 'true';
    const vid = searchParams.get('variant_id');

    if (q) setQuery(q);
    if (p) setPatientFilter(p);
    if (g) setGeneFilter(g);
    if (nosynth) setDoSynthesize(false);

    const parsedSig = sig ? sig.split(',').map(s => s.trim()).filter(Boolean) : [];
    if (parsedSig.length > 0) setSigFilter(parsedSig);

    if (vid) {
      setDoSynthesize(false);
      setLoading(true);
      getVariantById(vid)
        .then(async ({ data: pinned }) => {
          pinned._pinned = true;
          const gene = pinned.gene || g;
          if (gene) {
            setQuery(`${gene} variants`);
            setGeneFilter(gene);
            try {
              const { data: searchData } = await searchVariants({
                query: `${gene} variants`,
                limit: 40,
                gene,
                synthesize: false,
              });
              const pinnedKey = `${pinned.chromosome}:${pinned.position}:${pinned.ref_allele}:${pinned.alt_allele}`;
              const deduped = {};
              for (const v of (searchData.results || [])) {
                const key = `${v.chromosome}:${v.position}:${v.ref_allele}:${v.alt_allele}`;
                if (key === pinnedKey) continue;
                const existing = deduped[key];
                if (!existing || (v.similarity_score || 0) > (existing.similarity_score || 0)) {
                  deduped[key] = { ...v, _seen_count: (existing?._seen_count || 0) + 1 };
                } else {
                  existing._seen_count = (existing._seen_count || 1) + 1;
                }
              }
              setResults([pinned, ...Object.values(deduped)]);
            } catch {
              setResults([pinned]);
            }
          } else {
            setResults([pinned]);
          }
          setExpandedId(0);
        })
        .catch(() => setResults([]))
        .finally(() => setLoading(false));
      return;
    }

    if (q) {
      performSearch(q, p, !nosynth, parsedSig.length > 0 ? parsedSig : undefined, g || undefined);
    }
  }, [searchParams]);

  const loadExplanation = async (variant, index) => {
    setExplainingId(index);
    setExplanation((prev) => ({ ...prev, [index]: undefined }));
    try {
      const { data } = await explainVariant(variant);
      setExplanation((prev) => ({ ...prev, [index]: data.explanation }));
    } catch (err) {
      const detail = err.response?.data?.detail || err.message || 'LLM request failed';
      setExplanation((prev) => ({ ...prev, [index]: `__ERROR__${detail}` }));
    }
    setExplainingId(null);
  };

  const handleExpand = async (variant, index) => {
    if (expandedId === index) {
      setExpandedId(null);
      return;
    }
    setExpandedId(index);
    if (!explanation[index] && doSynthesize) {
      loadExplanation(variant, index);
    }
  };

  const fetchInsights = async (e, variant, index) => {
    if (e) e.stopPropagation();
    setInsights((prev) => ({ ...prev, [index]: undefined }));
    setFetchingInsightsId(index);
    try {
      const { data } = await getInsights(variant);
      setInsights((prev) => ({ ...prev, [index]: data.insights }));
    } catch (err) {
      const detail = err.response?.data?.detail || err.message || 'LLM request failed';
      setInsights((prev) => ({ ...prev, [index]: `__ERROR__${detail}` }));
    }
    setFetchingInsightsId(null);
  };

  return (
    <>
      <div className="card">
        <div className="search-bar">
          <input
            type="text"
            placeholder="e.g. variants associated with drug resistance in lung cancer..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          />
          <button className="btn btn-primary" onClick={handleSearch}>
            <Search size={16} /> Search
          </button>
        </div>
        <div className="filters-row">
          <input
            placeholder="Gene filter (e.g. BRCA1)"
            value={geneFilter}
            onChange={(e) => setGeneFilter(e.target.value)}
            style={{ flex: 1, padding: '8px 12px', background: 'var(--bg-input)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)', borderRadius: '6px', fontSize: '12px' }}
          />
          <input
            placeholder="Min Quality (e.g. 90)"
            type="number"
            value={qualityFilter}
            onChange={(e) => setQualityFilter(e.target.value)}
            style={{ flex: 1, padding: '8px 12px', background: 'var(--bg-input)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)', borderRadius: '6px', fontSize: '12px' }}
          />
          <input
            placeholder="Patient ID"
            value={patientFilter}
            onChange={(e) => setPatientFilter(e.target.value)}
            style={{ flex: 1, padding: '8px 12px', background: 'var(--bg-input)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)', borderRadius: '6px', fontSize: '12px' }}
          />
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--text-muted)', cursor: 'pointer' }}>
            <input type="checkbox" checked={doSynthesize} onChange={(e) => setDoSynthesize(e.target.checked)} />
            <Sparkles size={14} /> LLM Synthesis
          </label>
        </div>
        <div className="filters-row" style={{ marginTop: '12px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', fontSize: '12px', color: 'var(--text-muted)' }}>
            <strong>Significance:</strong>
            {['Pathogenic', 'Likely pathogenic', 'Uncertain significance', 'Likely benign', 'Benign'].map(sig => (
              <label key={sig} style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
                <input 
                  type="checkbox" 
                  checked={sigFilter.includes(sig)}
                  onChange={() => handleSigToggle(sig)}
                />
                {sig}
              </label>
            ))}
          </div>
        </div>
      </div>

      {loading && <div className="spinner" />}

      {stats && !loading && !patientData && results.length === 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '16px', marginBottom: '24px' }}>
          <div className="card" style={{ display: 'flex', alignItems: 'center', gap: '16px', padding: '20px' }}>
            <div style={{ background: 'var(--bg-card-hover)', padding: '12px', borderRadius: '50%', color: 'var(--accent)' }}>
              <Users size={24} />
            </div>
            <div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Registered Patients</div>
              <div style={{ fontSize: '24px', fontWeight: 'bold', color: 'var(--text-primary)' }}>{stats.total_patients}</div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>Avg Age: {stats.avg_patient_age} | Top Ethnicity: {stats.top_ethnicity}</div>
            </div>
          </div>
          
          <div className="card" style={{ display: 'flex', alignItems: 'center', gap: '16px', padding: '20px' }}>
            <div style={{ background: 'var(--bg-card-hover)', padding: '12px', borderRadius: '50%', color: 'var(--success)' }}>
              <Dna size={24} />
            </div>
            <div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Variants Analyzed</div>
              <div style={{ fontSize: '24px', fontWeight: 'bold', color: 'var(--text-primary)' }}>{stats.total_variants.toLocaleString()}</div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>Across {stats.total_samples} samples</div>
            </div>
          </div>

          <div className="card" style={{ display: 'flex', alignItems: 'center', gap: '16px', padding: '20px' }}>
            <div style={{ background: 'var(--bg-card-hover)', padding: '12px', borderRadius: '50%', color: 'var(--warning)' }}>
              <Clock size={24} />
            </div>
            <div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Compute Saved (hrs)</div>
              <div style={{ fontSize: '24px', fontWeight: 'bold', color: 'var(--text-primary)' }}>{stats.compute_hours_saved}</div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>Compared to CPU baselines</div>
            </div>
          </div>

          <div className="card" style={{ display: 'flex', alignItems: 'center', gap: '16px', padding: '20px' }}>
            <div style={{ background: 'var(--bg-card-hover)', padding: '12px', borderRadius: '50%', color: 'var(--accent)' }}>
              <Database size={24} />
            </div>
            <div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>API/LLM Calls Avoided</div>
              <div style={{ fontSize: '24px', fontWeight: 'bold', color: 'var(--text-primary)' }}>{stats.llm_api_calls_saved}</div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>Powered by Hybrid Memoization</div>
            </div>
          </div>

          <div className="card" style={{ display: 'flex', alignItems: 'center', gap: '16px', padding: '20px' }}>
            <div style={{ background: 'var(--bg-card-hover)', padding: '12px', borderRadius: '50%', color: 'var(--danger)' }}>
              <Zap size={24} />
            </div>
            <div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>GPU Accelerated Runs</div>
              <div style={{ fontSize: '24px', fontWeight: 'bold', color: 'var(--text-primary)' }}>{stats.gpu_accelerated_runs}</div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>Powered by NVIDIA Parabricks</div>
            </div>
          </div>
        </div>
      )}

      {patientData && (
        <div className="card">
          <div className="card-header">
            <h2>Patient Metadata: {patientData.patient_id}</h2>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px', fontSize: '13px' }}>
            <div>
              <span style={{ color: 'var(--text-muted)' }}>Age:</span>
              <br />
              <strong style={{ color: 'var(--text-primary)' }}>{patientData.age}</strong>
            </div>
            <div>
              <span style={{ color: 'var(--text-muted)' }}>Sex:</span>
              <br />
              <strong style={{ color: 'var(--text-primary)' }}>{patientData.sex}</strong>
            </div>
            <div>
              <span style={{ color: 'var(--text-muted)' }}>Ethnicity:</span>
              <br />
              <strong style={{ color: 'var(--text-primary)' }}>{patientData.ethnicity}</strong>
            </div>
            {patientData.clinical_history && (
              <div style={{ gridColumn: '1 / -1' }}>
                <span style={{ color: 'var(--text-muted)' }}>Clinical History:</span>
                <br />
                <span style={{ color: 'var(--text-primary)' }}>{patientData.clinical_history}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {searchError && (
        <div className="card" style={{ borderLeft: '3px solid var(--danger, #ff6b6b)', background: 'rgba(255, 107, 107, 0.06)' }}>
          <div style={{ fontSize: '13px', color: 'var(--text-primary)' }}>
            <strong>Search failed:</strong> {searchError}
          </div>
        </div>
      )}

      {synthLoading && (
        <div className="synthesis-panel">
          <h3><Sparkles size={14} /> Clinical Synthesis</h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13px', color: 'var(--text-muted)' }}>
            <Loader size={14} className="spinner" style={{ width: '14px', height: '14px', borderWidth: '2px', margin: 0 }} />
            Generating clinical synthesis (LLM cold-starts can take a few minutes)…
          </div>
        </div>
      )}

      {synthError && !synthLoading && (
        <div className="synthesis-panel" style={{ borderLeft: '3px solid var(--warning, #f5a623)' }}>
          <h3><Sparkles size={14} /> Clinical Synthesis</h3>
          <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
            Synthesis unavailable: {synthError}
          </div>
        </div>
      )}

      {synthesis && !synthLoading && !synthError && (
        <div className="synthesis-panel">
          <h3><Sparkles size={14} /> Clinical Synthesis</h3>
          <div className="markdown-body" style={{ fontSize: '13px', lineHeight: 1.6, color: 'var(--text-secondary)' }}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{synthesis}</ReactMarkdown>
          </div>
        </div>
      )}

      {results.length > 0 && (
        <div className="card">
          <div className="card-header">
            <h2><Database size={16} /> {results.length} Variants Found</h2>
          </div>
          {results.map((v, i) => {
            const isExpanded = expandedId === i;
            return (
              <div 
                className="variant-card" 
                key={i}
                style={v._pinned ? { borderLeft: '3px solid var(--accent)', background: 'rgba(102, 252, 241, 0.04)' } : undefined}
              >
                <div 
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', cursor: 'pointer' }}
                  onClick={() => handleExpand(v, i)}
                >
                  <div style={{ flex: 1, paddingRight: '16px' }}>
                    <div style={{ marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      {v._pinned && (
                        <span style={{ fontSize: '10px', color: '#0b0c10', background: 'var(--accent)', padding: '1px 8px', borderRadius: '4px', fontWeight: 700, letterSpacing: '0.5px' }}>
                          TARGET
                        </span>
                      )}
                      <span
                        className="gene-badge"
                        style={{ cursor: 'pointer' }}
                        title={`View ${v.gene} molecules in Explorer`}
                        onClick={(e) => { e.stopPropagation(); navigate(`/molecules?gene=${encodeURIComponent(v.gene)}`); }}
                      >
                        {v.gene || 'unknown'} <ExternalLink size={9} style={{ marginLeft: '2px', opacity: 0.6 }} />
                      </span>
                      <span className="variant-location">
                        {v.chromosome}:{v.position} {v.ref_allele}{'>'}{v.alt_allele}
                      </span>
                      {v._seen_count > 1 && (
                        <span style={{ fontSize: '10px', color: 'var(--text-muted)', background: 'var(--bg-card-hover)', padding: '2px 6px', borderRadius: '4px' }}>
                          {v._seen_count} patients
                        </span>
                      )}
                    </div>
                    <div className="variant-detail" style={{ marginTop: '0', display: '-webkit-box', WebkitLineClamp: isExpanded ? 'unset' : '2', WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                      {(v.variant_description || '').replace(/^Patient \S+ sample \S+: /, '').replace(/ AF=[\d.]+, DP=\d+, quality [\d.]+, \S+\.$/, '')}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
                    {v.similarity_score !== undefined && (
                      <span style={{ fontSize: '11px', color: 'var(--accent)' }}>
                        Match: {(v.similarity_score * 100).toFixed(1)}%
                      </span>
                    )}
                    {v.cache_hits_count > 0 && (
                      <span style={{ fontSize: '11px', color: 'var(--success)', display: 'flex', alignItems: 'center', gap: '4px', background: 'rgba(84, 231, 222, 0.1)', padding: '2px 6px', borderRadius: '4px' }}>
                        <Database size={10} /> {v.cache_hits_count} past {v.cache_hits_count === 1 ? 'patient' : 'patients'}
                      </span>
                    )}
                    <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Quality: {v.quality?.toFixed(1)}</span>
                    <span className={`badge ${
                      v.clinical_significance?.toLowerCase().includes('pathogenic') ? 'badge-danger' : 
                      v.clinical_significance?.toLowerCase().includes('benign') ? 'badge-success' : 
                      'badge-warning'
                    }`}>
                      {v.clinical_significance}
                    </span>
                    {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </div>
                </div>
                
                {isExpanded && (
                  <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid var(--border-subtle)' }}>
                    {doSynthesize ? (
                      explainingId === i ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--accent)', fontSize: '13px', marginBottom: '16px' }}>
                          <Loader size={14} style={{ animation: 'spin 1s linear infinite' }} /> 
                          Generating clinical explanation...
                        </div>
                      ) : explanation[i]?.startsWith('__ERROR__') ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px', padding: '10px 14px', background: 'rgba(232, 55, 86, 0.08)', border: '1px solid rgba(232, 55, 86, 0.25)', borderRadius: '8px' }}>
                          <span style={{ fontSize: '12px', color: 'var(--danger)', flex: 1 }}>
                            {explanation[i].replace('__ERROR__', '')}
                          </span>
                          <button
                            onClick={(e) => { e.stopPropagation(); loadExplanation(v, i); }}
                            style={{ fontSize: '11px', padding: '4px 10px', background: 'transparent', border: '1px solid var(--accent)', color: 'var(--accent)', borderRadius: '4px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap' }}
                          >
                            <RefreshCw size={11} /> Retry
                          </button>
                        </div>
                      ) : (
                        <div className="markdown-body variant-detail" style={{ color: 'var(--text-primary)', marginBottom: '16px', lineHeight: 1.6 }}>
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {explanation[i] || 'Explanation not available.'}
                          </ReactMarkdown>
                        </div>
                      )
                    ) : null}

                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: insights[i] ? '16px' : '0' }}>
                      <button 
                        className="btn btn-secondary" 
                        onClick={(e) => fetchInsights(e, v, i)}
                        disabled={fetchingInsightsId === i || (!!insights[i] && !insights[i].startsWith('__ERROR__'))}
                        style={{ fontSize: '12px', padding: '6px 12px' }}
                      >
                        {fetchingInsightsId === i ? (
                          <><Loader size={14} style={{ animation: 'spin 1s linear infinite' }} /> Loading Insights...</>
                        ) : (
                          <><BarChart2 size={14} /> Population & Drug Insights</>
                        )}
                      </button>
                    </div>

                    {insights[i]?.startsWith('__ERROR__') && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '12px', padding: '10px 14px', background: 'rgba(232, 55, 86, 0.08)', border: '1px solid rgba(232, 55, 86, 0.25)', borderRadius: '8px' }}>
                        <span style={{ fontSize: '12px', color: 'var(--danger)', flex: 1 }}>
                          {insights[i].replace('__ERROR__', '')}
                        </span>
                        <button
                          onClick={(e) => fetchInsights(e, v, i)}
                          style={{ fontSize: '11px', padding: '4px 10px', background: 'transparent', border: '1px solid var(--accent)', color: 'var(--accent)', borderRadius: '4px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap' }}
                        >
                          <RefreshCw size={11} /> Retry
                        </button>
                      </div>
                    )}

                    {insights[i] && !insights[i].startsWith('__ERROR__') && (
                      <div style={{ marginTop: '16px' }}>
                        <InsightsRenderer dataRaw={insights[i]} gene={v.gene} variantId={v.variant_id} />
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {!loading && results.length === 0 && query && (
        <div className="empty-state">
          <Search size={40} />
          <p>No variants found. Try a different query or broaden your filters.</p>
        </div>
      )}
    </>
  );
}

export default SearchPage;
