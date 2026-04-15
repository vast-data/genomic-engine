import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { GitBranch, RefreshCw, Loader2 } from 'lucide-react';
import { listPipelines } from '../services/api';

const AWAIT_POLL_MS = 4000;

function statusBadge(phase) {
  const map = {
    Succeeded: 'badge-success',
    completed: 'badge-success',
    Failed: 'badge-danger',
    failed: 'badge-danger',
    Running: 'badge-warning',
    processing: 'badge-warning',
    pending: 'badge-pending',
    Unknown: 'badge-pending',
  };
  return map[phase] || 'badge-pending';
}

const muted = { fontSize: '12px', color: 'var(--text-muted)' };
const link = { color: 'var(--accent)', cursor: 'pointer', textDecoration: 'none' };

function PipelineDashboard() {
  const [pipelines, setPipelines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [awaitingSample, setAwaitingSample] = useState(null);
  const navigate = useNavigate();
  const location = useLocation();
  const pollRef = useRef(null);
  const highlightRef = useRef(null);

  const fetchPipelines = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const { data } = await listPipelines();
      setPipelines(data.pipelines || []);
      return data.pipelines || [];
    } catch {
      setPipelines([]);
      return [];
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const sampleParam = params.get('sample');

    fetchPipelines(false).then((initial) => {
      if (!sampleParam) return;
      const found = initial.find((p) => p.sample_id === sampleParam && p.argo_workflow_id);
      if (found) {
        setAwaitingSample(null);
        navigate(`/pipelines/${found.argo_workflow_id}`);
        return;
      }
      setAwaitingSample(sampleParam);
    });
  }, [location.search]);

  useEffect(() => {
    if (!awaitingSample) {
      clearTimeout(pollRef.current);
      return;
    }
    pollRef.current = setTimeout(async () => {
      const updated = await fetchPipelines(true);
      const found = updated.find((p) => p.sample_id === awaitingSample && p.argo_workflow_id);
      if (found) {
        setAwaitingSample(null);
        navigate(`/pipelines/${found.argo_workflow_id}`);
      }
    }, AWAIT_POLL_MS);
    return () => clearTimeout(pollRef.current);
  }, [awaitingSample, pipelines]);

  useEffect(() => {
    if (highlightRef.current) {
      highlightRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [pipelines]);

  const params = new URLSearchParams(location.search);
  const highlightSample = params.get('sample');

  return (
    <div className="card">
      <div className="card-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <h2><GitBranch size={16} /> Pipeline Runs</h2>
          {awaitingSample && (
            <span style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              fontSize: '12px', color: 'var(--accent)',
              background: 'rgba(102,252,241,0.08)', border: '1px solid rgba(102,252,241,0.25)',
              borderRadius: '20px', padding: '2px 10px',
            }}>
              <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />
              Waiting for pipeline: {awaitingSample}
            </span>
          )}
        </div>
        <button className="btn btn-secondary" onClick={() => fetchPipelines(false)}>
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {loading ? (
        <div className="spinner" />
      ) : pipelines.length === 0 ? (
        <div className="empty-state">
          <GitBranch size={40} />
          <p>No pipeline runs yet. Upload a FASTQ file to start.</p>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Sample ID</th>
                <th>Patient ID</th>
                <th>Status</th>
                <th>Job ID</th>
                <th>FASTQ</th>
                <th>VCF</th>
                <th>Variants</th>
                <th>Registered</th>
              </tr>
            </thead>
            <tbody>
              {pipelines.map((p, i) => {
                const isHighlighted = highlightSample && p.sample_id === highlightSample;
                return (
                  <tr
                    key={i}
                    ref={isHighlighted ? highlightRef : null}
                    style={isHighlighted ? {
                      background: 'rgba(102,252,241,0.06)',
                      outline: '1px solid rgba(102,252,241,0.3)',
                    } : undefined}
                  >
                    <td style={link} onClick={() => p.argo_workflow_id && navigate(`/pipelines/${p.argo_workflow_id}`)}>
                      {p.sample_id}
                    </td>
                    <td style={link} onClick={() => navigate(`/patients?id=${p.patient_id}`)}>
                      {p.patient_id}
                    </td>
                    <td>
                      <span className={`badge ${statusBadge(p.argo_phase || p.status)}`}>
                        {p.argo_phase || p.status}
                      </span>
                    </td>
                    <td>
                      {p.argo_workflow_id ? (
                        <span style={{ ...muted, ...link }} onClick={() => navigate(`/pipelines/${p.argo_workflow_id}`)}>
                          {p.argo_workflow_id}
                        </span>
                      ) : (
                        <span style={muted}>—</span>
                      )}
                    </td>
                    <td style={muted}>{p.fastq_path || '—'}</td>
                    <td style={muted}>{p.vcf_path || '—'}</td>
                    <td>{p.variant_count || '—'}</td>
                    <td style={muted}>
                      {p.registered_at ? new Date(p.registered_at).toLocaleString() : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default PipelineDashboard;
