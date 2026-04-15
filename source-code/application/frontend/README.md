# Frontend

React 18 single-page application — the unified UI for the Genomic RAG Engine.

## What It Does

- **Register Sample**: Patient registration form with one-click mock data fill; triggers the full genomics pipeline on submit
- **Pipeline Dashboard**: Real-time status for all pipeline runs with inline DAG visualization and log streaming
- **Search**: Semantic variant search with filters (gene, quality, patient, clinical significance) and optional LLM synthesis toggle
- **Patient View**: Per-patient variant table, sample history, and drug discovery Insights panel
- **Molecules**: BioNeMo MolMIM molecule generation viewer with Tanimoto scores and docking results
- Dark theme throughout: `#0b0c10` background, `#1f2833` cards, `#66fcf1` accent

## Easy to Adjust

The frontend reads all configuration from the backend API — no build-time environment variables are needed.

UI pages map to components in `src/components/`:

| Component | Page |
|---|---|
| `UploadPage.js` | Register Sample |
| `PipelineDashboard.js` | Pipeline Dashboard |
| `PipelineDetail.js` | Pipeline Detail + Logs |
| `SearchPage.js` | Semantic Search |
| `PatientView.js` | Patient View |
| `MoleculesPage.js` | Drug Discovery (Molecules) |
| `LoginPage.js` | Authentication |

## What Runs It

- **Runtime**: Nginx web server (containerized), Kubernetes deployment in the `genomics` namespace
- **Image**: `vastdatasolutions/genomic-engine-frontend:latest`
- **Framework**: React 18, lucide-react icons
- **Build**: `npm run build` → static files served by Nginx
- **Dependencies**: Node.js for build, Nginx for serving
