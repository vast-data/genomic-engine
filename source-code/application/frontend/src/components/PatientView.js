import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Users, Search, Dna, Sparkles, Database } from 'lucide-react';
import { getPatient, getPatientVariants } from '../services/api';

function PatientView() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [patientId, setPatientId] = useState(searchParams.get('id') || '');
  const [patient, setPatient] = useState(null);
  const [variants, setVariants] = useState([]);
  const [geneFilter, setGeneFilter] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLookup = async (id) => {
    const lookupId = id || patientId;
    if (!lookupId.trim()) return;
    setLoading(true);
    try {
      const { data } = await getPatient(lookupId);
      setPatient(data);
      const variantRes = await getPatientVariants(lookupId, { gene: geneFilter || undefined });
      setVariants(variantRes.data.variants || []);
    } catch {
      setPatient(null);
      setVariants([]);
    }
    setLoading(false);
  };

  const handleAnalyze = () => {
    if (!patientId) return;
    navigate(`/?q=Analyze+risks+for+patient&patient=${patientId}&autoSearch=true&sig=Pathogenic,Likely+pathogenic`);
  };

  useEffect(() => {
    const id = searchParams.get('id');
    if (id) {
      setPatientId(id);
      handleLookup(id);
    }
  }, [searchParams]);

  const muted = { fontSize: '12px', color: 'var(--text-muted)' };
  const link = { color: 'var(--accent)', cursor: 'pointer' };

  return (
    <>
      <div className="card">
        <div className="search-bar">
          <input
            placeholder="Enter Patient ID"
            value={patientId}
            onChange={(e) => setPatientId(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleLookup()}
          />
          <input
            placeholder="Gene filter (optional)"
            value={geneFilter}
            onChange={(e) => setGeneFilter(e.target.value)}
            style={{ maxWidth: '200px' }}
          />
          <button className="btn btn-primary" onClick={() => handleLookup()}>
            <Search size={16} /> Lookup
          </button>
        </div>
      </div>

      {loading && <div className="spinner" />}

      {patient && (
        <div className="card">
          <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2><Users size={16} /> Patient {patient.patient_id}</h2>
            <button 
              className="btn btn-primary" 
              style={{ padding: '6px 12px', fontSize: '13px' }}
              onClick={handleAnalyze}
            >
              <Sparkles size={14} /> VAST AI Analyzer
            </button>
          </div>

          <div className="patient-header">
            <div className="patient-stat">
              <div className="stat-value">{patient.demographics?.age || '—'}</div>
              <div className="stat-label">Age</div>
            </div>
            <div className="patient-stat">
              <div className="stat-value">{patient.demographics?.sex || '—'}</div>
              <div className="stat-label">Sex</div>
            </div>
            <div className="patient-stat">
              <div className="stat-value">{patient.demographics?.weight_kg || '—'}</div>
              <div className="stat-label">Weight (kg)</div>
            </div>
            <div className="patient-stat">
              <div className="stat-value">{patient.demographics?.height_cm || '—'}</div>
              <div className="stat-label">Height (cm)</div>
            </div>
            <div className="patient-stat" style={{ borderLeft: '1px solid var(--border-subtle)', paddingLeft: '15px' }}>
              <div className="stat-value">{patient.sample_count}</div>
              <div className="stat-label">Samples</div>
            </div>
            <div className="patient-stat">
              <div className="stat-value">{patient.variant_count}</div>
              <div className="stat-label">Variants</div>
            </div>
          </div>

          {patient.samples && patient.samples.length > 0 && (
            <>
              <h3 style={{ fontSize: '14px', color: 'var(--text-primary)', marginBottom: '10px' }}>Samples</h3>
              <div style={{ overflowX: 'auto' }}>
                <table className="data-table" style={{ marginBottom: '20px' }}>
                  <thead>
                    <tr>
                      <th>Sample ID</th>
                      <th>Status</th>
                      <th>FASTQ Path</th>
                      <th>VCF Path</th>
                      <th>Workflow</th>
                      <th>Variants</th>
                    </tr>
                  </thead>
                  <tbody>
                    {patient.samples.map((s, i) => (
                      <tr key={i}>
                        <td
                          style={s.argo_workflow_id ? link : { color: 'var(--accent)' }}
                          onClick={() => s.argo_workflow_id && navigate(`/pipelines/${s.argo_workflow_id}`)}
                        >
                          {s.sample_id}
                        </td>
                        <td>
                          <span className={`badge ${s.status === 'completed' ? 'badge-success' : s.status === 'processing' ? 'badge-warning' : 'badge-pending'}`}>
                            {s.status}
                          </span>
                        </td>
                        <td style={muted}>{s.fastq_path || '—'}</td>
                        <td style={muted}>{s.vcf_path || '—'}</td>
                        <td>
                          {s.argo_workflow_id ? (
                            <span style={{ ...muted, ...link }} onClick={() => navigate(`/pipelines/${s.argo_workflow_id}`)}>
                              {s.argo_workflow_id}
                            </span>
                          ) : (
                            <span style={muted}>—</span>
                          )}
                        </td>
                        <td>{s.variant_count || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {variants.length > 0 && (
        <div className="card">
          <div className="card-header">
            <h2><Dna size={16} /> {variants.length} Variants</h2>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>Gene</th>
                <th>Location</th>
                <th>Change</th>
                <th>Type</th>
                <th>Quality</th>
                <th>Significance</th>
                <th>Description</th>
              </tr>
            </thead>
            <tbody>
              {variants.map((v, i) => (
                <tr key={i}>
                  <td>
                    <span style={{ display: 'inline-block', background: 'var(--accent)', color: 'var(--bg-primary)', padding: '2px 8px', borderRadius: '10px', fontSize: '11px', fontWeight: 700 }}>
                      {v.gene}
                    </span>
                    {v.cache_hits_count > 0 && (
                      <div style={{ fontSize: '10px', color: 'var(--success)', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '2px' }}>
                        <Database size={10} /> {v.cache_hits_count} cached hits
                      </div>
                    )}
                  </td>
                  <td>{v.chromosome}:{v.position}</td>
                  <td>{v.ref_allele}{'>'}{v.alt_allele}</td>
                  <td>{v.variant_type}</td>
                  <td>{v.quality?.toFixed(1)}</td>
                  <td>
                    <span className={`badge ${
                      v.clinical_significance?.toLowerCase().includes('pathogenic') ? 'badge-danger' : 
                      v.clinical_significance?.toLowerCase().includes('benign') ? 'badge-success' : 
                      'badge-warning'
                    }`}>
                      {v.clinical_significance}
                    </span>
                  </td>
                  <td style={{ maxWidth: '300px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={(v.variant_description || '').replace(/^Patient \S+ sample \S+: /, '').replace(/ AF=[\d.]+, DP=\d+, quality [\d.]+, \S+\.$/, '')}>
                    {(v.variant_description || '').replace(/^Patient \S+ sample \S+: /, '').replace(/ AF=[\d.]+, DP=\d+, quality [\d.]+, \S+\.$/, '')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && !patient && patientId && (
        <div className="empty-state">
          <Users size={40} />
          <p>No data found for this patient.</p>
        </div>
      )}
    </>
  );
}

export default PatientView;
