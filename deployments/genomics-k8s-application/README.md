# Deploy K8s Application (Backend / Frontend)

Deploy the Genomic RAG Engine web application to Kubernetes.

## Prerequisites

- **Kubernetes cluster** with `kubectl` configured and `helm` installed
- **VAST platform** resources ready — S3 buckets, VastDB bucket, Kafka topic, DataEngine triggers and functions (see [DataEngine Pipeline Guide](../dataengine-genomics-pipeline/README.md))
- **NVIDIA NIM** endpoints accessible (self-hosted) or an NVIDIA API Catalog key

---

## Step 1: Create Values File

```bash
cp deployments/genomics-k8s-application/values-template.yaml \
   deployments/genomics-k8s-application/values.yaml
```

Edit `values.yaml` and fill in:

| Section | Fields |
|---|---|
| `vast` | `access_key`, `secret_key` |
| `s3` | `endpoint` (VAST S3 endpoint) |
| `vdb` | `endpoint` (VastDB query engine endpoint) |
| `nvidia` | `use_api_catalog`, `api_key` (if using API Catalog) |
| `embedding` | `host`, `port` (if self-hosted NIM) |
| `llm` | `host`, `port` (if self-hosted NIM) |
| `bionemo` | `molmim_url`, `diffdock_url` — defaults to NVIDIA cloud, override for local NIM |
| `processing_mode` | `mock` (default) or `gpu` |

`values.yaml` is git-ignored — never commit credentials.

The `backend.image`, `frontend.image`, and `mock.parabricks.image` fields point to whatever registry/repo holds the built images — update them to your registry before deploying.

---

## Step 2: Build and Push Application Images (Optional)

> Builds are fully automated in GitLab CI — see the `.build-template` and the `build-backend`, `build-frontend`, `build-mock-parabricks` jobs in the project's [`.gitlab-ci.yml`](../../.gitlab-ci.yml). The steps below are the manual equivalent for local builds or one-off pushes to a custom registry.

Backend, frontend, and the mock Parabricks container are plain Dockerfile builds. From the repo root:

```bash
docker login <your-registry>

# Backend (FastAPI)
docker build -t <your-registry>/genomic-engine-backend:<tag>        ./source-code/application/backend
docker push  <your-registry>/genomic-engine-backend:<tag>

# Frontend (React, served by nginx)
docker build -t <your-registry>/genomic-engine-frontend:<tag>       ./source-code/application/frontend
docker push  <your-registry>/genomic-engine-frontend:<tag>

# Mock Parabricks (CPU-only dev replacement for the GPU compute container)
docker build -t <your-registry>/genomic-engine-mock-parabricks:<tag> ./source-code/application/backend/mock/parabricks
docker push  <your-registry>/genomic-engine-mock-parabricks:<tag>
```

Then update the image fields in `values.yaml`:

```yaml
global:
  imageTag: <tag>

backend:
  image: <your-registry>/genomic-engine-backend
frontend:
  image: <your-registry>/genomic-engine-frontend
mock:
  parabricks:
    image: <your-registry>/genomic-engine-mock-parabricks
job:
  mock:
    image: <your-registry>/genomic-engine-mock-parabricks:<tag>
```

CI tags each image with both the semver from the repo's `VERSION` file and a stream tag (`prod` + `latest` on `main`, `dev` on other branches) — mirror whichever convention you prefer locally.

---

## Step 3: Deploy with Helm

```bash
helm upgrade --install genomic-engine ./deployments/genomics-k8s-application \
  --namespace genomics --create-namespace \
  -f deployments/genomics-k8s-application/values.yaml
```

The chart creates the `genomics` namespace and renders the backend RBAC (ServiceAccount, Role, RoleBinding) that grants the backend permission to manage K8s Jobs and read pod logs.

---

## Step 4: Verify Pods

```bash
kubectl get pods -n genomics -w
```

Both `backend` and `frontend` pods should reach `Running` status.

---

## Step 5: Access the UI

```bash
kubectl get svc -n genomics
```

Open the frontend `NodePort` or `LoadBalancer` address in a browser. Navigate to **Register Sample**, click **Fill Mock Data**, and submit to run your first pipeline.

---

## External Services

### NVIDIA API Catalog (default)

Set `nvidia.use_api_catalog: true` and provide `nvidia.api_key`. All NVIDIA services — embedding, LLM, MolMIM, DiffDock — are routed to the NVIDIA cloud.

| Service | Model |
|---|---|
| Embedding | `nvidia/llama-3.2-nv-embedqa-1b-v2` (2048 dims) |
| LLM | `meta/llama-3.1-70b-instruct` |
| MolMIM | cloud `health.api.nvidia.com` |
| DiffDock | cloud `health.api.nvidia.com` |

---

## Local NIM Deployment (GPU Mode)

To run all NVIDIA services on-cluster — zero cloud dependency — set `nim.enabled: true` in `values.yaml`. The Helm chart will deploy four NIM containers, each pinned to a GPU node via the configured toleration.

### NIM containers deployed

| Service | Image | GPU | Memory |
|---|---|---|---|
| `nim-llm` | `nvcr.io/nim/meta/llama-3.1-8b-instruct` | 1 | 24 Gi |
| `nim-embed` | `nvcr.io/nim/nvidia/llama-3.2-nv-embedqa-1b-v2` | 1 | 8 Gi |
| `nim-molmim` | `nvcr.io/nim/nvidia/molmim` | 1 | 16 Gi |
| `nim-diffdock` | `nvcr.io/nim/mit/diffdock` | 1 | 24 Gi |

Minimum 4 GPU nodes required (or 4 GPUs on a single node with enough VRAM).

### Full values.yaml configuration for local NIM

```yaml
nvidia:
  use_api_catalog: false
  api_key: ""              # not needed for inference — only NGC pull uses ngc_api_key

embedding:
  host: nim-embed
  port: "8000"
  model: "nvidia/llama-3.2-nv-embedqa-1b-v2"
  dimensions: 2048

llm:
  host: nim-llm
  port: "8000"
  model: "meta/llama-3.1-8b-instruct"
  system_prompt: "..."

bionemo:
  molmim_url: "http://nim-molmim:8000/v1/biology/nvidia/molmim/generate"
  diffdock_url: "http://nim-diffdock:8000/v1/biology/mit/diffdock"

nim:
  enabled: true
  ngc_api_key: "<your-ngc-api-key>"
  cache_path: /mnt/nim-cache
  gpu_toleration:
    key: "sku"
    operator: "Equal"
    value: "gpu"
    effect: "NoSchedule"
  llm:
    image: nvcr.io/nim/meta/llama-3.1-8b-instruct:latest
    gpu: 1
    memory: 24Gi
  embedding:
    image: nvcr.io/nim/nvidia/llama-3.2-nv-embedqa-1b-v2:latest
    gpu: 1
    memory: 8Gi
  molmim:
    image: nvcr.io/nim/nvidia/molmim:latest
    gpu: 1
    memory: 16Gi
  diffdock:
    image: nvcr.io/nim/mit/diffdock:latest
    gpu: 1
    memory: 24Gi
```

> The `cache_path` hostPath (`/mnt/nim-cache`) must exist on every GPU node before deployment. NIM containers download model weights into this directory on first start — subsequent restarts reuse the cache.

### Monitor NIM pods

```bash
kubectl get pods -n genomics -l app=nim -w
kubectl logs -n genomics -l model=molmim -f
```

---

## GPU Mode (Real Parabricks)

The default `processing_mode: mock` uses a CPU-only container — no GPUs needed. To switch to real Parabricks:

1. Set `processing_mode: gpu` in `values.yaml`
2. Ensure GPU nodes have `nvidia.com/gpu` available and the NVIDIA device plugin installed
3. Place the GRCh38 reference genome at `/data/refs/hg38.fa` on the `vast-pvc-genomics` PVC
4. Redeploy with Helm

Also update `processing_mode` in the DataEngine ingest secret — see [Switching Processing Mode](../dataengine-genomics-pipeline/README.md#switching-processing-mode).

---

## Troubleshooting

| Symptom | What to check |
|---|---|
| Pods stuck in `Pending` | `kubectl describe pod -n genomics <pod>` — check resource constraints |
| Register fails with 404 | Source FASTQ not in `genomics-raw-data` — upload it first or use the mock filler |
| Register fails with 500 | `kubectl -n genomics logs deploy/backend` |
| Sample stays `pending` | DataEngine trigger not firing — check `genomics-fastq-trigger` in the DataEngine UI |
| Sample stays `processing` | K8s Job stuck: `kubectl -n genomics get jobs` |
| No VCF in output bucket | `kubectl -n genomics logs -l job-name=<job-id> -c upload-vcf` |
| Variants not in VastDB | Check `genomics-variant-processor` logs in the DataEngine UI |
| Search returns empty | Verify `status=completed` and `variant_count > 0` on the sample |
| LLM synthesis fails | Check `nvidia.api_key` and `use_api_catalog` in `values.yaml` |

### View Logs

```bash
# Backend
kubectl logs -n genomics -l app=backend -f

# Frontend
kubectl logs -n genomics -l app=frontend -f

# K8s compute job
kubectl logs -n genomics -l job-name=<job-id> -c compute-parabricks
```
