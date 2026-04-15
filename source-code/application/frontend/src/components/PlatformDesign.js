import React, { useState, useEffect } from 'react';
import {
  X, Activity, Database, Cpu, Brain, Zap, Save, Search,
  FileCode, GitMerge, Sparkles, Dna, HardDrive, LayoutDashboard,
  Server, Box, FlaskConical, Atom, Link, Shuffle, Download,
} from 'lucide-react';
import './PlatformDesign.css';

const PARTICLE_DURATION = '2s';

function LiveMetric({ label, value, unit }) {
  return (
    <div className="live-metric">
      <span className="metric-label">{label}</span>
      <span className="metric-value">
        {value}<span className="metric-unit">{unit}</span>
      </span>
    </div>
  );
}

function FlowNode({ icon: Icon, title, subtitle, badge, type = 'ui', active = true }) {
  return (
    <div className={`design-node node-${type}`}>
      {active && <div className="node-status" />}
      <div className="node-icon"><Icon /></div>
      <div className="node-title">{title}</div>
      {subtitle && <div className="node-subtitle">{subtitle}</div>}
      {badge && <div className="node-badge">{badge}</div>}
    </div>
  );
}

function Arrow({ type = 'forward', d1 = '0s', d2 = '0.67s', d3 = '1.33s' }) {
  return (
    <div className={`design-arrow arrow-${type}`}>
      <div className="arrow-particle"       style={{ '--duration': PARTICLE_DURATION, '--delay': d1 }} />
      <div className="arrow-particle"       style={{ '--duration': PARTICLE_DURATION, '--delay': d2 }} />
      <div className="arrow-particle"       style={{ '--duration': PARTICLE_DURATION, '--delay': d3 }} />
    </div>
  );
}

function DualArrow() {
  return (
    <div className="design-arrow arrow-dual">
      <div className="arrow-particle"         style={{ '--duration': PARTICLE_DURATION, '--delay': '0s' }} />
      <div className="arrow-particle"         style={{ '--duration': PARTICLE_DURATION, '--delay': '0.67s' }} />
      <div className="arrow-particle reverse" style={{ '--duration': PARTICLE_DURATION, '--delay': '0.33s' }} />
      <div className="arrow-particle reverse" style={{ '--duration': PARTICLE_DURATION, '--delay': '1s' }} />
    </div>
  );
}

function FlowSection({ icon: Icon, title, sub, children }) {
  return (
    <div className="flow-section">
      <div className="flow-section-header">
        <Icon size={15} />
        <span className="flow-section-title">{title}</span>
        {sub && <span className="flow-section-sub">{sub}</span>}
      </div>
      <div className="flow-row">{children}</div>
    </div>
  );
}

function IngestTab() {
  return (
    <div className="flow-diagram">
      <FlowSection
        icon={Download}
        title="Registration & Ingest"
        sub="FASTQ → S3 → DataEngine Trigger → fastq-registrar"
      >
        <FlowNode icon={Dna}             title="Patient FASTQ"     subtitle="Genomic source"       badge="Input"        type="ui" />
        <Arrow />
        <FlowNode icon={LayoutDashboard} title="React UI"          subtitle="Registration form"    badge="Frontend"     type="ui" />
        <DualArrow />
        <FlowNode icon={FileCode}        title="FastAPI Backend"   subtitle="Job orchestrator"     badge="K8s Svc"      type="k8s" />
        <Arrow />
        <FlowNode icon={HardDrive}       title="VAST S3 Raw"       subtitle="genomics-fastq-files" badge="S3 Bucket"    type="storage" />
        <Arrow />
        <FlowNode icon={Zap}             title="S3 Trigger"        subtitle="ObjectCreated event"  badge="DataEngine"   type="de" />
        <Arrow />
        <FlowNode icon={Server}          title="fastq-registrar"   subtitle="Submits K8s Job"      badge="DE Function"  type="de" />
      </FlowSection>

      <FlowSection
        icon={Cpu}
        title="GPU Compute — NVIDIA Parabricks"
        sub="K8s initContainers: download → compute → upload"
      >
        <FlowNode icon={Box}       title="K8s Job"         subtitle="initContainers"           badge="K8s"          type="k8s" />
        <Arrow type="nvidia" d1="0s" d2="0.55s" d3="1.1s" />
        <FlowNode icon={Download}  title="Download FASTQ"  subtitle="From VAST S3"             badge="initContainer" type="k8s" />
        <Arrow type="nvidia" d1="0.2s" d2="0.75s" d3="1.3s" />
        <FlowNode icon={Cpu}       title="Parabricks GPU"  subtitle="deepvariant_germline"     badge="NVIDIA GPU"   type="nvidia" />
        <Arrow type="nvidia" d1="0.4s" d2="0.95s" d3="1.5s" />
        <FlowNode icon={HardDrive} title="VAST S3 VCF"     subtitle="genomics-vcf-outputs"     badge="S3 Bucket"    type="storage" />
      </FlowSection>

      <FlowSection
        icon={Brain}
        title="DataEngine Processing Pipeline"
        sub="vcf-parser → NIM LLM → variant-processor → NIM Embed → VastDB"
      >
        <FlowNode icon={Zap}       title="S3 Trigger"          subtitle="On VCF arrival"          badge="DataEngine"   type="de" />
        <Arrow />
        <FlowNode icon={Brain}     title="vcf-parser"          subtitle="ClinVar + memoize"       badge="DE Function"  type="de" />
        <DualArrow />
        <FlowNode icon={Sparkles}  title="NIM LLM"             subtitle="Clinical summaries"      badge="NVIDIA NIM"   type="nvidia" />
        <Arrow />
        <FlowNode icon={GitMerge}  title="variant-processor"   subtitle="Embed + bulk write"      badge="DE Function"  type="de" />
        <DualArrow />
        <FlowNode icon={Cpu}       title="NIM Embed"           subtitle="1024-dim vectors"        badge="NVIDIA NIM"   type="nvidia" />
        <Arrow type="nvidia" d1="0s" d2="0.55s" d3="1.1s" />
        <FlowNode icon={Database}  title="VastDB"              subtitle="variants + vectors"      badge="VastDB"       type="vastdb" />
      </FlowSection>
    </div>
  );
}

function RetrievalTab() {
  return (
    <div className="flow-diagram">
      <FlowSection
        icon={Search}
        title="Retrieval & Semantic Search"
        sub="Query → Embed → ADBC VSS → VastDB → LLM Synthesis → Results"
      >
        <FlowNode icon={LayoutDashboard} title="Search UI"       subtitle="Clinical query"        badge="Frontend"    type="ui" />
        <DualArrow />
        <FlowNode icon={FileCode}        title="FastAPI Backend" subtitle="REST / orchestration"  badge="K8s Svc"     type="k8s" />
        <Arrow />
        <FlowNode icon={Cpu}             title="NIM Embed"       subtitle="Query → vector"        badge="NVIDIA NIM"  type="nvidia" />
        <Arrow type="nvidia" d1="0s" d2="0.6s" d3="1.2s" />
        <FlowNode icon={GitMerge}        title="ADBC Driver"     subtitle="array_cosine_distance" badge="ADBC"        type="k8s" />
        <Arrow />
        <FlowNode icon={Database}        title="VastDB VSS"      subtitle="Server-side search"    badge="VastDB"      type="vastdb" />
        <Arrow />
        <FlowNode icon={Sparkles}        title="NIM LLM"         subtitle="Clinical synthesis"    badge="NVIDIA NIM"  type="nvidia" />
        <Arrow type="nvidia" d1="0.1s" d2="0.7s" d3="1.3s" />
        <FlowNode icon={Dna}             title="Variant Results" subtitle="Ranked + explained"    badge="Results"     type="ui" />
      </FlowSection>

      <FlowSection
        icon={FlaskConical}
        title="Drug Discovery — NVIDIA BioNeMo"
        sub="Variant → Gene → PubChem SMILES → MolMIM → RCSB PDB → DiffDock → VastDB cache"
      >
        <FlowNode icon={Dna}          title="Gene / Variant"   subtitle="Insights panel"          badge="UI"          type="ui" />
        <Arrow type="bio" d1="0s" d2="0.6s" d3="1.2s" />
        <FlowNode icon={Search}       title="PubChem API"      subtitle="Drug name → SMILES"      badge="PubChem"     type="bio" />
        <Arrow type="bio" d1="0.1s" d2="0.7s" d3="1.3s" />
        <FlowNode icon={Shuffle}      title="MolMIM"           subtitle="Novel molecules (CMA-ES)" badge="BioNeMo NIM" type="nvidia" />
        <Arrow type="nvidia" d1="0s" d2="0.55s" d3="1.1s" />
        <FlowNode icon={Atom}         title="RCSB PDB"         subtitle="Protein 3D structure"    badge="RCSB API"    type="bio" />
        <Arrow type="bio" d1="0.2s" d2="0.8s" d3="1.4s" />
        <FlowNode icon={Link}         title="DiffDock"         subtitle="Blind docking poses"     badge="BioNeMo NIM" type="nvidia" />
        <Arrow type="nvidia" d1="0.3s" d2="0.9s" d3="1.5s" />
        <FlowNode icon={Save}         title="VastDB Cache"     subtitle="Results + annotations"   badge="VastDB"      type="vastdb" />
      </FlowSection>

      <FlowSection
        icon={Database}
        title="VAST Storage Fabric"
        sub="Unified storage layer powering every phase"
      >
        <FlowNode icon={HardDrive}   title="VAST S3"         subtitle="genomics-raw-data"          badge="Ingress"     type="storage" />
        <Arrow />
        <FlowNode icon={HardDrive}   title="VAST S3"         subtitle="genomics-fastq-files"       badge="Controlled"  type="storage" />
        <Arrow />
        <FlowNode icon={HardDrive}   title="VAST S3"         subtitle="genomics-vcf-outputs"       badge="Output"      type="storage" />
        <Arrow />
        <FlowNode icon={Database}    title="VastDB"          subtitle="patients · samples · jobs"  badge="OLTP"        type="vastdb" />
        <Arrow />
        <FlowNode icon={Database}    title="VastDB VSS"      subtitle="variants + embeddings"      badge="VectorDB"    type="vastdb" />
        <Arrow />
        <FlowNode icon={Zap}         title="DataEngine"      subtitle="Serverless functions"       badge="DE"          type="de" />
      </FlowSection>
    </div>
  );
}

const TABS = [
  { id: 'ingest',    label: 'Ingest & Compute' },
  { id: 'retrieval', label: 'Retrieval & Discovery' },
];

export default function PlatformDesign({ onClose }) {
  const [activeTab, setActiveTab] = useState('ingest');
  const [metrics, setMetrics] = useState({ throughput: '4.2', vectorRate: '1.1K', latency: '28', jobs: 3 });

  useEffect(() => {
    const iv = setInterval(() => {
      setMetrics({
        throughput: (Math.random() * 2 + 3).toFixed(1),
        vectorRate: (Math.random() * 0.5 + 0.8).toFixed(1) + 'K',
        latency: Math.floor(Math.random() * 20 + 18),
        jobs: Math.floor(Math.random() * 3 + 1),
      });
    }, 2500);
    return () => clearInterval(iv);
  }, []);

  return (
    <div className="design-overlay">
      <div className="design-page">

        <div className="design-header">
          <div className="design-header-left">
            <Activity className="design-header-icon" />
            <h2>Platform Design</h2>
            <span className="live-badge">● LIVE DATA FLOW</span>
          </div>
          <div className="design-metrics">
            <LiveMetric label="Throughput"   value={metrics.throughput}  unit=" MB/s" />
            <LiveMetric label="Vectors"      value={metrics.vectorRate}  unit="/s" />
            <LiveMetric label="VSS Latency"  value={metrics.latency}     unit=" ms" />
            <LiveMetric label="Active Jobs"  value={metrics.jobs}        unit="" />
          </div>
          <button className="close-btn" onClick={onClose} title="Close">
            <X size={22} />
          </button>
        </div>

        <div className="design-tabs">
          {TABS.map(tab => (
            <button
              key={tab.id}
              className={`design-tab ${activeTab === tab.id ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="design-canvas">
          {activeTab === 'ingest'    && <IngestTab />}
          {activeTab === 'retrieval' && <RetrievalTab />}
        </div>

      </div>
    </div>
  );
}
