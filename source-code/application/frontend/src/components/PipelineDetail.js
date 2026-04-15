import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  GitBranch, Terminal, CheckCircle, XCircle, Clock, Loader,
  FileText, Users, ExternalLink, RefreshCw,
  Dna, Database, Cpu, Brain, Zap, Save, GitMerge,
  Download, HardDrive, Box, Server, Sparkles, Layers, AlertCircle,
} from 'lucide-react';
import { getPipeline, getPipelineLogs } from '../services/api';
import './PlatformDesign.css';

const PARTICLE_DURATION = '1.8s';
const CHILD_PARTICLE_DURATION = '1.4s';

function nodeType(name) {
  const n = (name || '').toLowerCase();
  if (
    n.includes('parabricks') || n.includes('ai/ml') || n.includes('ai ml') ||
    n.includes('analysis') || n.includes('gpu') || n.includes('embed') ||
    n.includes('nim') || n.includes('llm') ||
    (n.includes('compute') && !n.includes('mock'))
  ) return 'nvidia';
  if (n.includes('vastdb') || n.includes('vdb') || n.includes('ingest') || n.includes('vector')) return 'vastdb';
  if (
    n.includes('variant') || n.includes('processing') ||
    n.includes('parser') || n.includes('registrar') || n.includes('processor') ||
    n.includes('trigger')
  ) return 'de';
  if (
    n.includes('upload') || n.includes('download') ||
    n.includes('fastq') || n.includes('vcf') ||
    n.includes('mock') || n.includes('k8s') || n.includes('job')
  ) return 'k8s';
  if (n.includes('s3') || n.includes('storage') || n.includes('bucket')) return 'storage';
  return 'default';
}

function isVASTProcessingNode(name) {
  const n = (name || '').toLowerCase();
  return n.includes('processor') || (n.includes('processing') && !n.includes('mock'));
}

function nodeIcon(name, type) {
  const n = (name || '').toLowerCase();
  if (n.includes('fastq') || n.includes('dna') || n.includes('genomic')) return Dna;
  if (n.includes('parabricks') || n.includes('gpu') || n.includes('ai') || n.includes('analysis')) return Cpu;
  if (n.includes('embed')) return Brain;
  if (n.includes('llm') || n.includes('synthesis')) return Sparkles;
  if (n.includes('parser') || n.includes('parse')) return Brain;
  if (n.includes('processor') || (n.includes('variant') && !n.includes('ingest'))) return GitMerge;
  if (n.includes('registrar') || n.includes('register')) return Server;
  if (n.includes('trigger')) return Zap;
  if (n.includes('download')) return Download;
  if (n.includes('upload')) return HardDrive;
  if (n.includes('ingest') || n.includes('vastdb') || n.includes('vector')) return Database;
  if (n.includes('vcf') || n.includes('s3') || n.includes('storage')) return HardDrive;
  const fallback = { nvidia: Cpu, vastdb: Database, de: Zap, k8s: Box, storage: HardDrive, default: GitMerge };
  return fallback[type] || GitMerge;
}

const TYPE_BADGE = {
  nvidia: 'NVIDIA', vastdb: 'VastDB', de: 'DataEngine',
  k8s: 'K8s', storage: 'S3', default: '',
};

const VAST_CHILD_STEPS = [
  { name: 'DataEngine Function', type: 'de',      Icon: Zap,       badge: 'Serverless'   },
  { name: 'NIM Embedding',       type: 'nvidia',   Icon: Brain,     badge: 'NVIDIA NIM'   },
  { name: 'VastDB · VectorDB',   type: 'vastdb',   Icon: Database,  badge: 'VastDB'       },
  { name: 'VAST S3 Persist',     type: 'storage',  Icon: HardDrive, badge: 'Logs & State' },
];

const STEP_CYCLE_MS = 2000;

const STEP_COLORS = {
  de:      { r: '167,139,250', icon: '#c4b5fd', label: 'purple' },
  nvidia:  { r: '118,185,0',   icon: '#a3e635', label: 'green'  },
  vastdb:  { r: '115,200,253', icon: '#bae6fd', label: 'cyan'   },
  storage: { r: '115,200,253', icon: '#93c5fd', label: 'cyan'   },
};

function stepNodeStyle(type, state) {
  const c = STEP_COLORS[type] || STEP_COLORS.storage;
  const base = {
    transition: 'all 0.45s cubic-bezier(0.34,1.56,0.64,1)',
    position: 'relative', borderRadius: 8, padding: '10px 12px',
    textAlign: 'center', minWidth: 82, maxWidth: 100, flexShrink: 0, cursor: 'default',
  };
  if (state === 'active') return { ...base,
    background: `linear-gradient(135deg, #0d1829, rgba(${c.r},0.12))`,
    border: `1.5px solid rgba(${c.r},0.7)`,
    boxShadow: `0 0 10px rgba(${c.r},0.45), 0 0 22px rgba(${c.r},0.12)`,
    transform: 'scale(1.04) translateY(-2px)', zIndex: 5, opacity: 1,
  };
  if (state === 'done') return { ...base,
    background: 'linear-gradient(135deg, #0d1829, rgba(84,231,222,0.07))',
    border: '1.5px solid rgba(84,231,222,0.35)',
    boxShadow: '0 0 7px rgba(84,231,222,0.18)',
    transform: 'scale(1)', zIndex: 1, opacity: 1,
  };
  // idle — visible but clearly not active
  return { ...base,
    background: '#0d1829',
    border: `1.5px solid rgba(${c.r},0.12)`,
    boxShadow: 'none', transform: 'scale(1)', zIndex: 1, opacity: 0.4,
  };
}

function stepIconStyle(type, state) {
  const c = STEP_COLORS[type] || STEP_COLORS.storage;
  if (state === 'active') return { display: 'flex', justifyContent: 'center', marginBottom: 6, color: c.icon, filter: `drop-shadow(0 0 6px rgba(${c.r},0.75))` };
  if (state === 'done')   return { display: 'flex', justifyContent: 'center', marginBottom: 6, color: '#54e7de', filter: 'drop-shadow(0 0 4px rgba(84,231,222,0.5))' };
  return { display: 'flex', justifyContent: 'center', marginBottom: 6, color: 'rgba(255,255,255,0.3)' };
}

function phaseIcon(phase) {
  const icons = {
    Succeeded: <CheckCircle size={11} style={{ color: 'var(--success)' }} />,
    Failed:    <XCircle    size={11} style={{ color: 'var(--danger)' }} />,
    Running:   <Loader     size={11} style={{ color: 'var(--accent)' }} />,
    Pending:   <Clock      size={11} style={{ color: 'var(--text-muted)' }} />,
  };
  return icons[phase] || <Clock size={11} style={{ color: 'var(--text-muted)' }} />;
}

function ChildArrow({ destType, paused }) {
  const arrowType = destType === 'nvidia' ? 'nvidia' : 'forward';
  const pStyle = (delay) => ({
    '--duration': CHILD_PARTICLE_DURATION,
    '--delay': delay,
    animationPlayState: paused ? 'paused' : 'running',
    opacity: paused ? 0 : 1,
  });
  return (
    <div className={`design-arrow arrow-${arrowType} dag-child-arrow`}>
      <div className="arrow-particle" style={pStyle('0s')} />
      <div className="arrow-particle" style={pStyle('0.5s')} />
    </div>
  );
}

function DagArrow({ destName, paused }) {
  const t = nodeType(destName);
  const arrowType = t === 'nvidia' ? 'nvidia' : 'forward';
  const pStyle = (delay) => ({
    '--duration': PARTICLE_DURATION,
    '--delay': delay,
    animationPlayState: paused ? 'paused' : 'running',
    opacity: paused ? 0 : 1,
  });
  return (
    <div className={`design-arrow arrow-${arrowType}`}>
      <div className="arrow-particle" style={pStyle('0s')} />
      <div className="arrow-particle" style={pStyle('0.6s')} />
      <div className="arrow-particle" style={pStyle('1.2s')} />
    </div>
  );
}

function VASTGroupNode({ node, onLogClick, variantCount, stalled }) {
  const phase = (node.phase || 'Pending').toLowerCase();
  const isComplete = phase === 'succeeded' || variantCount > 0;

  const [activeStep, setActiveStep] = useState(0);
  const [loopsDone, setLoopsDone]   = useState(0);
  const intervalRef  = useRef(null);
  const everRunningRef = useRef(phase === 'running');

  useEffect(() => {
    clearInterval(intervalRef.current);

    if (phase === 'running') {
      everRunningRef.current = true;
    }

    if (!everRunningRef.current || phase !== 'running') {
      setActiveStep(0);
      setLoopsDone(0);
      return;
    }

    setActiveStep(0);
    setLoopsDone(0);

    intervalRef.current = setInterval(() => {
      setActiveStep(prev => {
        const next = prev + 1;
        if (next >= VAST_CHILD_STEPS.length) {
          setLoopsDone(d => d + 1);
          return 0;
        }
        return next;
      });
    }, 2000);

    return () => clearInterval(intervalRef.current);
  }, [phase]);

  // Stop when backend confirms completion (≥2 loops) OR after MAX_LOOPS regardless
  useEffect(() => {
    if ((isComplete && loopsDone >= 2) || loopsDone >= MAX_LOOPS || stalled) {
      clearInterval(intervalRef.current);
    }
  }, [isComplete, loopsDone, stalled]);

  const allDone    = isComplete && (phase !== 'running' || loopsDone >= 2);
  // DataEngine appears stuck: animation exhausted but no backend confirmation
  const isStalled  = !allDone && (loopsDone >= MAX_LOOPS || stalled);

  const ss = (i) => {
    if (allDone)   return 'done';
    if (isStalled) return 'idle';
    return i === activeStep ? 'active' : 'idle';
  };

  return (
    <div
      className={`dag-group dag-phase-${phase}`}
      onClick={() => onLogClick(node.id)}
      title="Click to view logs"
    >
      {isStalled && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 5,
          fontSize: '0.58rem', fontWeight: 600, letterSpacing: '0.04em',
          color: '#f59e0b', marginBottom: 8, paddingBottom: 6,
          borderBottom: '1px solid rgba(245,158,11,0.2)',
        }}>
          <AlertCircle size={11} style={{ color: '#f59e0b', flexShrink: 0 }} />
          DataEngine processing incomplete — check function logs
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'nowrap' }}>
        {VAST_CHILD_STEPS.map((step, i) => {
          const state  = ss(i);
          const showCount = state === 'done' && step.type === 'vastdb' && variantCount > 0;
          const arrowOp   = allDone ? 1 : isStalled ? 0.06 : state === 'active' ? 0.8 : 0.12;
          return (
            <React.Fragment key={step.name}>
              <div style={stepNodeStyle(step.type, state)}>
                {/* per-step indicator dot */}
                <div style={{
                  position: 'absolute', top: 4, right: 4,
                  width: 6, height: 6, borderRadius: '50%',
                  background:  state === 'active' ? '#4ade80' : state === 'done' ? '#54e7de' : 'rgba(255,255,255,0.1)',
                  boxShadow:   state === 'active' ? '0 0 6px #4ade80, 0 0 12px rgba(74,222,128,0.4)' : state === 'done' ? '0 0 4px rgba(84,231,222,0.6)' : 'none',
                  transition: 'all 0.4s ease',
                }} />

                <div style={stepIconStyle(step.type, state)}>
                  <step.Icon size={16} />
                </div>

                <div style={{
                  fontSize: '0.6rem',
                  fontWeight: 600,
                  color: state === 'active' ? '#e8ebec' : state === 'done' ? '#a5f3fc' : 'rgba(255,255,255,0.22)',
                  lineHeight: 1.2, marginBottom: 4,
                  transition: 'all 0.4s ease',
                }}>
                  {step.name}
                </div>

                <div style={{
                  fontSize: '0.47rem',
                  color: state === 'active' ? STEP_COLORS[step.type].icon : state === 'done' ? 'rgba(84,231,222,0.75)' : 'rgba(255,255,255,0.12)',
                  border: `1px solid ${state === 'active' ? `rgba(${STEP_COLORS[step.type].r},0.4)` : state === 'done' ? 'rgba(84,231,222,0.3)' : 'rgba(255,255,255,0.07)'}`,
                  borderRadius: 20, padding: '1px 5px',
                  fontWeight: state !== 'idle' ? 700 : 400,
                  transition: 'all 0.4s ease',
                }}>
                  {showCount ? `${variantCount.toLocaleString()} vars` : step.badge}
                </div>
              </div>

              {i < VAST_CHILD_STEPS.length - 1 && (
                <div style={{ opacity: arrowOp, transition: 'opacity 0.5s ease', flexShrink: 0 }}>
                  <ChildArrow destType={VAST_CHILD_STEPS[i + 1].type} paused={allDone} />
                </div>
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}

function RegularDagNode({ node, onLogClick }) {
  const type = nodeType(node.name);
  const Icon = nodeIcon(node.name, type);
  const phase = (node.phase || 'Pending').toLowerCase();
  const badge = TYPE_BADGE[type];

  return (
    <div
      className={`design-node node-${type} dag-phase-${phase}`}
      onClick={() => onLogClick(node.id)}
      title={`Click to view logs for ${node.name}`}
    >
      <div className={`dag-status-dot dot-${phase}`} />
      <div className="node-icon"><Icon /></div>
      <div className="node-title">{node.name}</div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px', marginTop: '4px' }}>
        {phaseIcon(node.phase)}
        {badge && <span className="node-badge">{badge}</span>}
      </div>
    </div>
  );
}

const TERMINAL_PHASES = new Set(['Succeeded', 'Failed', 'Error']);
const POLL_INTERVAL_MS = 5000;
const MAX_POLLS = 72;  // 6 minutes ceiling — stops if DataEngine is silently stuck
const MAX_LOOPS = 3;   // child-step animation loops before showing stalled state

const label = { fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase' };
const value = { color: 'var(--text-primary)', fontSize: '13px', wordBreak: 'break-all' };
const link = { color: 'var(--accent)', cursor: 'pointer' };

function PipelineDetail() {
  const { name } = useParams();
  const navigate = useNavigate();
  const [workflow, setWorkflow] = useState(null);
  const [logs, setLogs] = useState([]);
  const [showLogs, setShowLogs] = useState(false);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [isPolling, setIsPolling] = useState(false);
  const [pollingStalled, setPollingStalled] = useState(false);
  const timerRef = useRef(null);
  const pollCountRef = useRef(0);

  const fetchWorkflow = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const { data } = await getPipeline(name);
      setWorkflow(data);
      setLastUpdated(new Date());
      return data;
    } catch {
      return null;
    } finally {
      if (!silent) setLoading(false);
    }
  }, [name]);

  const scheduleNextPoll = useCallback((data) => {
    if (!data) { setIsPolling(false); return; }
    const sampleStatus = (data.sample?.status || '').toLowerCase();
    const fullyDone = sampleStatus === 'completed' || sampleStatus === 'failed';
    const jobFailed  = data.phase === 'Failed' || data.phase === 'Error';
    pollCountRef.current += 1;
    const timedOut = pollCountRef.current >= MAX_POLLS;
    if (fullyDone || jobFailed || timedOut) {
      setIsPolling(false);
      if (timedOut && !fullyDone && !jobFailed) setPollingStalled(true);
      return;
    }
    setIsPolling(true);
    timerRef.current = setTimeout(async () => {
      const next = await fetchWorkflow(true);
      scheduleNextPoll(next);
    }, POLL_INTERVAL_MS);
  }, [fetchWorkflow]);

  useEffect(() => {
    pollCountRef.current = 0;
    setPollingStalled(false);
    fetchWorkflow(false).then(scheduleNextPoll);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [name]);

  const fetchLogs = async (podName = null) => {
    setShowLogs(true);
    setLogs([{ content: 'Loading logs...' }]);
    try {
      const { data } = await getPipelineLogs(name, podName);
      setLogs(data.logs || []);
    } catch {
      setLogs([{ content: 'Failed to fetch logs.' }]);
    }
  };

  if (loading) return <div className="spinner" />;
  if (!workflow) return <div className="empty-state"><p>Workflow not found.</p></div>;

  const dag_nodes = workflow.dag_nodes || [];
  const sample = workflow.sample || {};
  const sampleStatus = (sample.status || '').toLowerCase();
  const pipelineDone = sampleStatus === 'completed' || sampleStatus === 'failed'
    || workflow.phase === 'Failed' || workflow.phase === 'Error';

  return (
    <>
      <div className="card">
        <div className="card-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <h2><GitBranch size={16} /> {workflow.name}</h2>
            {workflow.argo_ui_url && (
              <a
                href={workflow.argo_ui_url}
                target="_blank"
                rel="noopener noreferrer"
                style={{ ...link, fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}
                title="Open in Argo UI"
              >
                <ExternalLink size={14} />
              </a>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            {isPolling && (
              <span style={{
                fontSize: '0.62rem', fontWeight: 700, color: '#4ade80',
                background: 'rgba(74,222,128,0.1)', border: '1px solid rgba(74,222,128,0.3)',
                borderRadius: '20px', padding: '2px 8px', letterSpacing: '0.04em',
                animation: 'livePulse 1.5s ease-in-out infinite',
              }}>
                ● LIVE
              </span>
            )}
            {lastUpdated && (
              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                {lastUpdated.toLocaleTimeString()}
              </span>
            )}
            <button
              className="btn btn-secondary"
              onClick={() => {
                if (timerRef.current) clearTimeout(timerRef.current);
                fetchWorkflow(false).then(scheduleNextPoll);
              }}
              style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 10px', fontSize: '12px' }}
            >
              <RefreshCw size={14} /> Refresh
            </button>
            <span className={`badge ${workflow.phase === 'Succeeded' ? 'badge-success' : workflow.phase === 'Failed' ? 'badge-danger' : 'badge-warning'}`}>
              {workflow.phase}
            </span>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '20px' }}>
          <div>
            <span style={label}>Patient</span><br />
            <span style={{ ...value, ...link }} onClick={() => navigate(`/patients?id=${workflow.patient_id}`)}>
              <Users size={12} /> {workflow.patient_id || '—'}
            </span>
          </div>
          <div>
            <span style={label}>Sample</span><br />
            <span style={{ ...value, ...link }} onClick={() => navigate(`/patients?id=${workflow.patient_id}`)}>
              {workflow.sample_id || '—'}
            </span>
          </div>
          <div>
            <span style={label}>Status</span><br />
            <span style={value}>{sample.status || workflow.phase}</span>
          </div>
        </div>

        {(sample.fastq_path || sample.vcf_path) && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '20px', padding: '12px', background: 'var(--bg-primary)', borderRadius: '8px', border: '1px solid var(--border-subtle)' }}>
            <div>
              <span style={label}><FileText size={11} /> FASTQ Path</span><br />
              <span style={{ ...value, fontSize: '12px' }}>{sample.fastq_path || '—'}</span>
            </div>
            <div>
              <span style={label}><FileText size={11} /> VCF Output</span><br />
              <span style={{ ...value, fontSize: '12px' }}>{sample.vcf_path || 'pending'}</span>
            </div>
            <div>
              <span style={label}>Variant Count</span><br />
              <span style={value}>{sample.variant_count || '—'}</span>
            </div>
            <div>
              <span style={label}>Registered</span><br />
              <span style={{ ...value, fontSize: '12px' }}>{sample.registered_at ? new Date(sample.registered_at).toLocaleString() : '—'}</span>
            </div>
          </div>
        )}

        <h3 style={{ fontSize: '14px', color: 'var(--text-primary)', marginBottom: '12px' }}>DAG</h3>
        <div className="dag-container">
          {dag_nodes.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', textAlign: 'center', position: 'relative', zIndex: 1 }}>No DAG nodes available.</p>
          ) : (
            <div className="flow-row" style={{ alignItems: 'center', position: 'relative', zIndex: 1 }}>
              {dag_nodes.map((node, i) => (
                <React.Fragment key={node.id}>
                  {isVASTProcessingNode(node.name)
                    ? <VASTGroupNode node={node} onLogClick={fetchLogs} variantCount={sample.variant_count || 0} stalled={pollingStalled} />
                    : <RegularDagNode node={node} onLogClick={fetchLogs} />
                  }
                  {i < dag_nodes.length - 1 && (
                    <DagArrow destName={dag_nodes[i + 1]?.name} paused={pipelineDone} />
                  )}
                </React.Fragment>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h2><Terminal size={16} /> Logs</h2>
          {!showLogs && (
            <button className="btn btn-secondary" onClick={() => fetchLogs()}>
              Load All Logs
            </button>
          )}
          {showLogs && (
            <button className="btn btn-secondary" style={{ padding: '4px 8px', fontSize: '12px' }} onClick={() => fetchLogs()}>
              Reload All
            </button>
          )}
        </div>
        {showLogs && (
          <div className="log-viewer">
            {logs.length === 0 ? 'No logs available.' : logs.map((l) => l.content).join('\n')}
          </div>
        )}
      </div>
    </>
  );
}

export default PipelineDetail;
