import React from 'react';
import { X, BookOpen, FileText, Database, Zap, Shield, Cpu, Brain, FlaskConical, Atom, Link } from 'lucide-react';
import './SharedModal.css';

const TerminologyModal = ({ onClose }) => {
  return (
    <div className="blueprint-overlay">
      <div className="blueprint-page">
        <div className="page-header">
          <div className="header-title">
            <BookOpen className="header-icon" />
            <h2>Terminology</h2>
          </div>
          <button className="close-btn" onClick={onClose} title="Close">
            <X size={24} />
          </button>
        </div>

        <div className="page-content" style={{ maxWidth: '800px' }}>
          <div className="blueprint-container">
            <div className="platform-header">
              <div className="platform-badge" style={{ fontSize: '1.2rem', color: 'var(--accent)' }}>
                Platform Components & Terminology
              </div>
            </div>

            <div className="pipeline-section">
              <div className="capabilities-grid" style={{ gridTemplateColumns: '1fr', gap: '1rem' }}>
                <div className="capability-item" style={{ padding: '1.5rem', justifyContent: 'flex-start', gap: '1rem' }}>
                  <FileText size={24} color="var(--accent)" style={{ flexShrink: 0 }} />
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                    <span style={{ fontSize: '1.1rem', fontWeight: 'bold', marginBottom: '0.5rem' }}>FASTQ File</span>
                    <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', lineHeight: '1.5' }}>
                      FASTQ is a text-based format storing both raw biological sequencing reads and their corresponding quality scores, serving as the foundational input for genomic analysis pipelines.
                    </span>
                  </div>
                </div>

                <div className="capability-item" style={{ padding: '1.5rem', justifyContent: 'flex-start', gap: '1rem' }}>
                  <Cpu size={24} color="var(--accent)" style={{ flexShrink: 0 }} />
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                    <span style={{ fontSize: '1.1rem', fontWeight: 'bold', marginBottom: '0.5rem' }}>Parabricks & DeepVariant</span>
                    <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', lineHeight: '1.5' }}>
                      NVIDIA Parabricks is a GPU-accelerated suite that drastically speeds up genomic secondary analysis, while DeepVariant is an AI-based tool within it that uses deep learning image classification to identify genetic mutations with unprecedented accuracy.
                    </span>
                  </div>
                </div>

                <div className="capability-item" style={{ padding: '1.5rem', justifyContent: 'flex-start', gap: '1rem' }}>
                  <Database size={24} color="var(--accent)" style={{ flexShrink: 0 }} />
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                    <span style={{ fontSize: '1.1rem', fontWeight: 'bold', marginBottom: '0.5rem' }}>VCF (Variant Call Format)</span>
                    <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', lineHeight: '1.5' }}>
                      A VCF file is a standardized text format used to record identified gene sequence variations (like SNPs and INDELs) and their annotations compared to a reference genome.
                    </span>
                  </div>
                </div>

                <div className="capability-item" style={{ padding: '1.5rem', justifyContent: 'flex-start', gap: '1rem' }}>
                  <Shield size={24} color="var(--accent)" style={{ flexShrink: 0 }} />
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                    <span style={{ fontSize: '1.1rem', fontWeight: 'bold', marginBottom: '0.5rem' }}>ClinVar</span>
                    <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', lineHeight: '1.5' }}>
                      ClinVar is a freely accessible, public archive reporting the clinical significance of human genetic variations and their relationship to specific diseases and phenotypes.
                    </span>
                  </div>
                </div>

                <div className="capability-item" style={{ padding: '1.5rem', justifyContent: 'flex-start', gap: '1rem' }}>
                  <Brain size={24} color="var(--accent)" style={{ flexShrink: 0 }} />
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                    <span style={{ fontSize: '1.1rem', fontWeight: 'bold', marginBottom: '0.5rem' }}>MyVariant.info</span>
                    <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', lineHeight: '1.5' }}>
                      MyVariant.info is a high-performance, open-source API service that continuously aggregates and provides comprehensive variant annotation data from dozens of independent sources.
                    </span>
                  </div>
                </div>

                <div className="capability-item" style={{ padding: '1.5rem', justifyContent: 'flex-start', gap: '1rem' }}>
                  <Zap size={24} color="var(--accent)" style={{ flexShrink: 0 }} />
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                    <span style={{ fontSize: '1.1rem', fontWeight: 'bold', marginBottom: '0.5rem' }}>Memoization</span>
                    <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', lineHeight: '1.5' }}>
                      Memoization is a programmatic optimization technique that dramatically speeds up execution by storing the results of expensive function calls (such as variant annotations) and returning the cached result when the identical inputs occur again.
                    </span>
                  </div>
                </div>

                <div className="capability-item" style={{ padding: '1.5rem', justifyContent: 'flex-start', gap: '1rem' }}>
                  <FlaskConical size={24} color="var(--accent)" style={{ flexShrink: 0 }} />
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                    <span style={{ fontSize: '1.1rem', fontWeight: 'bold', marginBottom: '0.5rem' }}>NVIDIA BioNeMo & MolMIM</span>
                    <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', lineHeight: '1.5' }}>
                      NVIDIA BioNeMo is a cloud platform for generative AI in drug discovery. MolMIM (Molecular Masked Image Modeling) is one of its models — it takes a known drug's SMILES string as a seed and generates novel small-molecule candidates optimized for drug-likeness (QED) using a CMA-ES evolutionary algorithm. Results are ranked by Tanimoto similarity to the seed compound. MolMIM only works with small molecules; biologics such as antibodies require different model architectures.
                    </span>
                  </div>
                </div>

                <div className="capability-item" style={{ padding: '1.5rem', justifyContent: 'flex-start', gap: '1rem' }}>
                  <Link size={24} color="var(--accent)" style={{ flexShrink: 0 }} />
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                    <span style={{ fontSize: '1.1rem', fontWeight: 'bold', marginBottom: '0.5rem' }}>DiffDock</span>
                    <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', lineHeight: '1.5' }}>
                      DiffDock (MIT / NVIDIA) is a diffusion-based model for blind protein-ligand docking. Given a protein structure (from RCSB PDB) and a small-molecule SMILES string, it predicts the most likely 3D binding poses and outputs a confidence score for each. Higher confidence scores indicate a more favorable binding interaction. DiffDock does not require a predefined binding pocket, making it suitable for exploratory drug discovery on novel targets.
                    </span>
                  </div>
                </div>

                <div className="capability-item" style={{ padding: '1.5rem', justifyContent: 'flex-start', gap: '1rem' }}>
                  <Atom size={24} color="var(--accent)" style={{ flexShrink: 0 }} />
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                    <span style={{ fontSize: '1.1rem', fontWeight: 'bold', marginBottom: '0.5rem' }}>SMILES & RCSB PDB</span>
                    <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', lineHeight: '1.5' }}>
                      SMILES (Simplified Molecular Input Line Entry System) is a compact text notation that encodes the full structure of a chemical compound — atoms, bonds, and topology — in a single string (e.g., <code style={{ fontFamily: 'monospace', background: 'var(--bg-nav)', padding: '0 4px', borderRadius: '3px' }}>CC(=O)Oc1ccccc1C(=O)O</code> for aspirin). RCSB PDB (Protein Data Bank) is the global open-access repository for experimentally determined 3D structures of proteins and nucleic acids. The platform searches RCSB by gene name to retrieve candidate protein targets for docking.
                    </span>
                  </div>
                </div>
              </div>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
};

export default TerminologyModal;
