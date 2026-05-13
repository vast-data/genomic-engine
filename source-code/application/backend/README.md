# Backend

FastAPI REST API — the central orchestrator for patient registration, pipeline management, semantic search, and drug discovery.

## What It Does

- Registers patients and samples in VastDB; validates FASTQ source files in S3; copies FASTQ to the controlled path (`genomics-fastq-files/{patient_id}/{sample_id}/`)
- Submits Kubernetes Jobs for Parabricks / mock compute and runs a background `job_watcher` that polls K8s and syncs job status to VastDB
- Executes vector similarity search via `array_cosine_distance` (ADBC driver, server-side) with automatic clinical significance re-ranking
- Synthesizes search results into clinical insights using NVIDIA Llama 3.1 Nemotron 70B
- Full drug discovery pipeline: PubChem SMILES lookup → NVIDIA MolMIM molecule generation → RCSB PDB structure search → NVIDIA DiffDock protein-ligand docking → results and researcher annotations cached in VastDB

## API Routes

### Search & Insights

| Route | Description |
|---|---|
| `POST /api/v1/search` | Semantic variant search (+ optional LLM synthesis) |
| `POST /api/v1/search/explain` | LLM plain-language explanation of a single variant |
| `POST /api/v1/search/insights` | Personalized clinical insights for a variant + patient context |
| `GET /api/v1/stats` | Platform statistics (patients, variants, cache hits, compute hours) |

### Drug Discovery

| Route | Description |
|---|---|
| `POST /api/v1/search/molecules` | Generate novel molecules via NVIDIA MolMIM from a drug name or SMILES string; results cached in VastDB |
| `GET /api/v1/search/structures/{gene}` | Search RCSB PDB for protein structures associated with a gene |
| `POST /api/v1/search/dock` | Dock a generated molecule against a PDB structure via NVIDIA DiffDock; result cached in VastDB |
| `GET /api/v1/search/molecules/all` | List all generated molecules across all variants |
| `GET /api/v1/search/molecules/{variant_id}` | Molecules generated for a specific variant |
| `POST /api/v1/search/molecules/{id}/annotate` | Append a researcher annotation or status change to a molecule |

### Patients & Pipelines

| Route | Description |
|---|---|
| `POST /api/v1/auth/login` | JWT authentication |
| `POST /api/v1/register` | Register patient + sample, copy FASTQ, trigger pipeline |
| `GET /api/v1/patients` | List all patients |
| `GET /api/v1/patients/{id}` | Patient details with samples |
| `GET /api/v1/patients/{id}/variants` | Patient's variant records |
| `GET /api/v1/pipelines` | All pipeline runs |
| `GET /api/v1/pipelines/{id}` | Pipeline detail with K8s logs |
| `GET /health` | Health check with processing mode |

### Drug Discovery Flow

```
Variant (gene) selected in UI
    → POST /search/molecules   drug_name or SMILES → PubChem lookup → MolMIM (CMA-ES, QED optimization)
                                                                      → novel SMILES + Tanimoto scores
                                                                      → saved to VastDB molecules table
    → GET  /search/structures/{gene}               RCSB PDB search  → ranked protein structures
    → POST /search/dock        molecule_id + pdb_id → DiffDock        → docking poses + confidence scores
                                                                      → best pose SDF + protein PDB cached
    → POST /search/molecules/{id}/annotate          researcher notes / status changes persisted
```

Both MolMIM results and DiffDock results are cached in VastDB — re-running the same seed SMILES or the same molecule+PDB pair returns the cached result instantly.

## Easy to Adjust

All configuration comes from `deployments/genomics-k8s-application/values.yaml`, mounted as a K8s Secret at `/etc/secrets/config.yaml`:

| Section | Key Settings |
|---|---|
| `vast` | `access_key`, `secret_key` |
| `s3` | `endpoint` |
| `vdb` | `endpoint`, `bucket`, `schema` |
| `nvidia` | `use_api_catalog`, `api_key` |
| `embedding` | `host`, `port`, `model`, `dimensions` |
| `llm` | `host`, `port`, `model` |
| `processing_mode` | `mock` or `gpu` |

## What Runs It

- **Runtime**: Kubernetes deployment in the `genomics` namespace
- **Image**: `<your-registry>/genomic-engine-backend:<tag>`
- **Framework**: FastAPI (Python 3.11), Uvicorn
- **VastDB access**: Python SDK for CRUD; ADBC driver (`libadbc_driver_vastdb.so`) for vector search
- **Dependencies**: `fastapi`, `vastdb`, `adbc-driver-manager`, `boto3`, `kubernetes`, `openai`
