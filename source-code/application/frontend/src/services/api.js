import axios from 'axios';

const API_BASE = process.env.REACT_APP_API_URL || '/api/v1';

const api = axios.create({ baseURL: API_BASE });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response && error.response.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('username');
      window.location.href = '/';
    }
    return Promise.reject(error);
  }
);

const LLM_TIMEOUT_MS = 125000;

export const login = (credentials) => api.post('/auth/login', credentials);
export const searchVariants = (params) => api.post('/search', params);
export const synthesizeSearch = (params, options = {}) => api.post('/search/synthesize', params, { timeout: LLM_TIMEOUT_MS, ...options });
export const getVariantById = (variantId) => api.get(`/search/variant/${encodeURIComponent(variantId)}`);
export const explainVariant = (variant) => api.post('/search/explain', { variant }, { timeout: LLM_TIMEOUT_MS });
export const getInsights = (variant) => api.post('/search/insights', { variant }, { timeout: LLM_TIMEOUT_MS });
export const getPatient = (patientId) => api.get(`/patients/${patientId}`);
export const getPatientVariants = (patientId, params) => api.get(`/patients/${patientId}/variants`, { params });
export const getStats = () => api.get('/stats');
export const listPipelines = () => api.get('/pipelines');
export const getPipeline = (name) => api.get(`/pipelines/${name}`);
export const getPipelineLogs = (name, pod) => api.get(`/pipelines/${name}/logs`, { params: { pod } });
export const registerSample = (data) => api.post('/register', data);
export const getConfig = () => api.get('/config');
export const generateMolecules = (params) => api.post('/search/molecules', params);
export const getAllMolecules = () => api.get('/search/molecules/all');
export const lookupStructures = (gene) => api.get(`/search/structures/${encodeURIComponent(gene)}`);
export const dockMolecule = (params) => api.post('/search/dock', params);
export const getVariantMolecules = (variantId) => api.get(`/search/molecules/${encodeURIComponent(variantId)}`);
export const getMoleculeDockingBlobs = (moleculeId) => api.get(`/search/molecules/${encodeURIComponent(moleculeId)}/docking-blobs`);
export const annotateMolecule = (moleculeId, params) => api.post(`/search/molecules/${encodeURIComponent(moleculeId)}/annotate`, params);
export const adminReset = () => api.post('/admin/reset', { confirm: true }, { timeout: LLM_TIMEOUT_MS });

export default api;
