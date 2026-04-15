import React from 'react';
import { X, Info, Shield, Server, Zap, Brain, Database, Cpu } from 'lucide-react';
import './SharedModal.css';

const AboutModal = ({ onClose }) => {
  return (
    <div className="blueprint-overlay">
      <div className="blueprint-page">
        <div className="page-header">
          <div className="header-title">
            <Info className="header-icon" />
            <h2>About VASTRiant</h2>
          </div>
          <button className="close-btn" onClick={onClose} title="Close">
            <X size={24} />
          </button>
        </div>

        <div className="page-content" style={{ maxWidth: '800px' }}>
          <div className="blueprint-container">
            {/* Version Header */}
            <div className="platform-header">
              <div className="platform-badge" style={{ fontSize: '1.2rem', color: 'var(--accent)' }}>
                VASTRiant Genomic Pipeline
              </div>
              <div className="platform-value" style={{ margin: '0 auto', fontSize: '0.9rem' }}>
                Version 1.0.0
              </div>
            </div>

            {/* Powered By Section */}
            <div className="pipeline-section">
              <div className="section-title">
                <Zap size={18} />
                <span>Powered By</span>
              </div>
              <div className="capabilities-grid" style={{ gridTemplateColumns: '1fr', gap: '1rem' }}>
                <div className="capability-item" style={{ padding: '1rem', justifyContent: 'flex-start', gap: '1rem' }}>
                  <Database size={24} color="var(--accent)" />
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                    <span style={{ fontSize: '1rem', fontWeight: 'bold' }}>VAST Data Platform</span>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>The universal storage data platform for the AI era</span>
                  </div>
                </div>
                <div className="capability-item" style={{ padding: '1rem', justifyContent: 'flex-start', gap: '1rem' }}>
                  <Server size={24} color="var(--accent)" />
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                    <span style={{ fontSize: '1rem', fontWeight: 'bold' }}>VAST DataEngine</span>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Event-driven serverless computing framework</span>
                  </div>
                </div>
              </div>
            </div>

            {/* What is VAST DataEngine */}
            <div className="pipeline-section">
              <div className="section-title">
                <Server size={18} />
                <span>What is VAST DataEngine?</span>
              </div>
              <p style={{ color: 'var(--text-secondary)', lineHeight: '1.6', fontSize: '0.9rem', marginTop: '1rem' }}>
                VAST DataEngine is a breakthrough serverless execution framework built directly into the VAST Data Platform. 
                Instead of moving massive genomic datasets to external compute clusters, DataEngine brings the compute 
                to the data. It uses S3 object events to trigger near-instantaneous Kafka-based function execution 
                (like FASTQ registration and VCF parsing) right where the data lives. This eliminates data silos, 
                reduces network latency, and radically simplifies genomic pipeline orchestration.
              </p>
            </div>

            {/* Nvidia Parabricks & DeepVariant */}
            <div className="pipeline-section">
              <div className="section-title">
                <Brain size={18} />
                <span>NVIDIA Parabricks & DeepVariant</span>
              </div>
              <div style={{ color: 'var(--text-secondary)', lineHeight: '1.6', fontSize: '0.9rem', marginTop: '1rem' }}>
                <p style={{ marginBottom: '1rem' }}>
                  <strong>NVIDIA Parabricks</strong> is a GPU-accelerated computational genomics software suite. By leveraging the massive parallel processing power of NVIDIA GPUs rather than traditional CPUs, Parabricks accelerates secondary analysis workflows (like BWA alignment and variant calling) by up to 50x. It is super fast and significantly more accurate than standard commercial and open-source equivalents. This exponential speedup saves critical time and money while drastically reducing the possibility of pipeline failures.
                </p>
                <p>
                  <strong>DeepVariant</strong> is a highly accurate, AI/deep-learning based variant caller optimized within Parabricks. Instead of using traditional statistical models, DeepVariant treats variant calling as an image classification problem, "looking" at pileups of sequencing reads using a Convolutional Neural Network (CNN). This provides unprecedented sensitivity and precision in detecting SNPs and INDELs, particularly in noisy or difficult genomic regions.
                </p>
              </div>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
};

export default AboutModal;
