import React, { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ClipboardList, CheckCircle, AlertCircle, Loader2, ArrowRight } from 'lucide-react';
import { registerSample, getPatient, getConfig } from '../services/api';

const INITIAL_FORM = {
  source_path: '',
  patient_id: '',
  sample_id: '',
  age: '',
  sex: '',
  ethnicity: '',
  weight_kg: '',
  height_cm: '',
  notes: '',
};

function UploadPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState(INITIAL_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [patientLoaded, setPatientLoaded] = useState(false);
  const [lookingUp, setLookingUp] = useState(false);
  const [isMockMode, setIsMockMode] = useState(false);

  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const { data } = await getConfig();
        if (data.processing_mode === 'mock') {
          setIsMockMode(true);
        }
      } catch (err) {
        console.error('Failed to fetch config:', err);
      }
    };
    fetchConfig();
  }, []);

  const update = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const lookupPatient = useCallback(async () => {
    if (!form.patient_id.trim()) return;
    setLookingUp(true);
    try {
      const { data } = await getPatient(form.patient_id);
      if (data.demographics) {
        const d = data.demographics;
        setForm((f) => ({
          ...f,
          age: d.age ?? '',
          sex: d.sex ?? '',
          ethnicity: d.ethnicity ?? '',
          weight_kg: d.weight_kg ?? '',
          height_cm: d.height_cm ?? '',
          notes: d.notes ?? '',
        }));
        setPatientLoaded(true);
      }
    } catch {
      setPatientLoaded(false);
    }
    setLookingUp(false);
  }, [form.patient_id]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setResult(null);

    const payload = { source_path: form.source_path, patient_id: form.patient_id };
    if (form.sample_id) payload.sample_id = form.sample_id;
    if (form.age) payload.age = parseInt(form.age, 10);
    if (form.sex) payload.sex = form.sex;
    if (form.ethnicity) payload.ethnicity = form.ethnicity;
    if (form.weight_kg) payload.weight_kg = parseFloat(form.weight_kg);
    if (form.height_cm) payload.height_cm = parseFloat(form.height_cm);
    if (form.notes) payload.notes = form.notes;

    try {
      const { data } = await registerSample(payload);
      setResult({ success: true, data });
      setForm(INITIAL_FORM);
      setPatientLoaded(false);
    } catch (err) {
      console.error(err);
      let detail = 'Registration failed.';
      
      if (err.response?.status === 422) {
        const errors = err.response.data.detail;
        if (Array.isArray(errors)) {
          detail = `Missing or invalid fields: ${errors.map(e => e.loc[e.loc.length - 1]).join(', ')}`;
        } else if (typeof errors === 'string') {
          detail = errors;
        } else {
          detail = 'Missing required clinical fields (age, sex, ethnicity, weight, or height).';
        }
      } else if (err.response?.data?.detail) {
        detail = err.response.data.detail;
      }
      
      setResult({ success: false, message: detail });
    }
    setSubmitting(false);
  };

  const canSubmit = form.source_path.trim() && form.patient_id.trim() && !submitting;

  const fillMockData = () => {
    const ethnicities = ['Caucasian', 'African', 'Asian', 'Hispanic', 'Middle Eastern', 'Other'];
    const sexes = ['M', 'F'];
    
    setForm({
      source_path: 's3://genomics-raw-data/incoming/sample_R1.fastq.gz',
      patient_id: `P${Math.floor(Math.random() * 100000)}`,
      sample_id: `S${Math.floor(Math.random() * 100000)}`,
      age: String(Math.floor(Math.random() * 80) + 18), // 18 to 97
      sex: sexes[Math.floor(Math.random() * sexes.length)],
      ethnicity: ethnicities[Math.floor(Math.random() * ethnicities.length)],
      weight_kg: (Math.random() * 50 + 50).toFixed(1), // 50.0 to 100.0
      height_cm: (Math.random() * 40 + 150).toFixed(1), // 150.0 to 190.0
      notes: 'Mock generated patient for testing the pipeline.',
    });
    setPatientLoaded(false);
  };

  return (
    <form onSubmit={handleSubmit}>
      <div className="card">
        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2><ClipboardList size={16} /> Register Sample</h2>
          {isMockMode && (
            <button 
              type="button" 
              onClick={fillMockData} 
              style={{ 
                padding: '6px 12px', 
                fontSize: '12px', 
                border: '1px solid var(--border-subtle)', 
                background: 'var(--bg-input)', 
                color: 'var(--text-primary)', 
                borderRadius: '6px', 
                cursor: 'pointer',
                transition: 'border-color 0.2s'
              }}
              onMouseOver={(e) => e.target.style.borderColor = 'var(--accent)'}
              onMouseOut={(e) => e.target.style.borderColor = 'var(--border-subtle)'}
            >
              Fill Mock Data
            </button>
          )}
        </div>

        {/* Source file section */}
        <fieldset style={fieldsetStyle}>
          <legend style={legendStyle}>Source File</legend>
          <input
            style={inputStyle}
            placeholder="s3://bucket/path/to/sample_R1.fastq.gz"
            value={form.source_path}
            onChange={update('source_path')}
            required
          />
          <p style={hintStyle}>Full S3 URI of the raw FASTQ file to register</p>
        </fieldset>

        {/* Patient section */}
        <fieldset style={fieldsetStyle}>
          <legend style={legendStyle}>Patient</legend>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <input
              style={{ ...inputStyle, flex: 1 }}
              placeholder="Patient ID (required)"
              value={form.patient_id}
              onChange={(e) => { update('patient_id')(e); setPatientLoaded(false); }}
              onBlur={lookupPatient}
              required
            />
            {lookingUp && <Loader2 size={16} style={{ color: 'var(--accent)', animation: 'spin 1s linear infinite' }} />}
            {patientLoaded && <span style={{ fontSize: '11px', color: 'var(--success)' }}>auto-filled</span>}
          </div>

          <div className="upload-fields" style={{ marginTop: '12px' }}>
            <input style={inputStyle} placeholder="Age" type="number" min="0" max="150" value={form.age} onChange={update('age')} />
            <select style={inputStyle} value={form.sex} onChange={update('sex')}>
              <option value="">Sex</option>
              <option value="M">Male</option>
              <option value="F">Female</option>
              <option value="Other">Other</option>
            </select>
            <input style={inputStyle} placeholder="Ethnicity" value={form.ethnicity} onChange={update('ethnicity')} />
            <input style={inputStyle} placeholder="Weight (kg)" type="number" step="0.1" min="0" value={form.weight_kg} onChange={update('weight_kg')} />
            <input style={inputStyle} placeholder="Height (cm)" type="number" step="0.1" min="0" value={form.height_cm} onChange={update('height_cm')} />
          </div>
          <textarea
            style={{ ...inputStyle, marginTop: '12px', minHeight: '60px', resize: 'vertical' }}
            placeholder="Clinical notes (optional)"
            value={form.notes}
            onChange={update('notes')}
          />
        </fieldset>

        {/* Sample section */}
        <fieldset style={fieldsetStyle}>
          <legend style={legendStyle}>Sample</legend>
          <input
            style={inputStyle}
            placeholder="Sample ID (auto-generated if empty)"
            value={form.sample_id}
            onChange={update('sample_id')}
          />
          <p style={hintStyle}>Leave empty to auto-generate from patient ID + timestamp</p>
        </fieldset>

        <div style={{ marginTop: '20px' }}>
          <button
            className="btn btn-primary"
            type="submit"
            disabled={!canSubmit}
            style={{ width: '100%' }}
          >
            {submitting ? <><Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> Registering...</> : <><ClipboardList size={16} /> Register and Start Pipeline</>}
          </button>
        </div>

        {result && (
          <div style={{
            marginTop: '16px',
            padding: '12px',
            background: 'var(--bg-primary)',
            borderRadius: '8px',
            border: `1px solid ${result.success ? 'var(--success)' : 'var(--danger)'}`,
          }}>
            {result.success && result.data && (
              <button
                onClick={() => navigate(`/pipelines?sample=${result.data.sample_id}`)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '8px',
                  width: '100%', marginBottom: '10px',
                  padding: '8px 12px', borderRadius: '6px', cursor: 'pointer',
                  background: 'rgba(102,252,241,0.08)',
                  border: '1px solid rgba(102,252,241,0.4)',
                  color: 'var(--accent)', fontSize: '13px', fontWeight: 600,
                  transition: 'background 0.2s',
                }}
                onMouseOver={(e) => e.currentTarget.style.background = 'rgba(102,252,241,0.15)'}
                onMouseOut={(e) => e.currentTarget.style.background = 'rgba(102,252,241,0.08)'}
              >
                <ArrowRight size={15} />
                View Pipeline: {result.data.sample_id}
              </button>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: result.success ? 'var(--success)' : 'var(--danger)' }}>
              {result.success ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
              {result.success ? 'Sample registered. Pipeline triggered.' : result.message}
            </div>
            {result.success && result.data && (
              <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '6px' }}>
                <div>Patient: {result.data.patient_id}</div>
                <div>Path: {result.data.fastq_path}</div>
              </div>
            )}
          </div>
        )}
      </div>
    </form>
  );
}

const fieldsetStyle = {
  border: '1px solid var(--border-subtle)',
  borderRadius: '8px',
  padding: '16px',
  marginBottom: '16px',
};

const legendStyle = {
  fontSize: '12px',
  fontWeight: 600,
  color: 'var(--accent)',
  textTransform: 'uppercase',
  letterSpacing: '0.8px',
  padding: '0 8px',
};

const inputStyle = {
  width: '100%',
  padding: '10px 14px',
  background: 'var(--bg-input)',
  border: '1px solid var(--border-subtle)',
  color: 'var(--text-primary)',
  borderRadius: '6px',
  fontSize: '13px',
  outline: 'none',
};

const hintStyle = {
  fontSize: '11px',
  color: 'var(--text-muted)',
  marginTop: '4px',
};

export default UploadPage;
