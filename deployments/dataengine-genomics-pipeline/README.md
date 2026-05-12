# Deploy Ingest Pipeline (VAST DataEngine)

Deploy the genomics serverless ingest pipeline using the DataEngine UI.

> **Assumption:** This guide assumes you already have a running VAST cluster with **DataEngine enabled** and a **Kubernetes cluster attached** to it (the cluster where DataEngine functions and pipelines actually execute). If you need to install/enable DataEngine first, follow the official VAST KB article: [Enabling DataEngine on a VAST Cluster Tenant](https://kb.vastdata.com/documentation/docs/enabling-data-engine-on-a-vast-cluster-tenant) — it walks through the container registry, Kubernetes cluster attachment (VAST Zarf DataEngine package), and event-broker setup.

## Prerequisites

- VAST DataEngine enabled on the tenant, with a Kubernetes cluster attached and a Kafka broker available
- `genomics-user` with DataEngine permissions (leading group: `data-engine-group`)
- Docker Hub registry added to the DataEngine tenant in VMS

## Pipeline Overview

**Pipeline Name:** `genomics-pipeline`

```
genomics-fastq-files bucket → genomics-fastq-registrar (submits K8s Job)
                                        ↓
genomics-vcf-outputs bucket  → genomics-vcf-parser → genomics-variant-processor
```

## Files in This Directory

| File | Description |
|---|---|
| `genomics-ingest-template.yaml` | Secret template for all three functions — copy to `genomics-ingest.yaml`, fill in, and upload |
| `genomics-pipeline-template.yaml` | Pipeline manifest (reference) |

---

## Step 1: Create VAST Platform Resources

All VAST platform resources are provisioned through the **VAST Management Service (VMS) UI**. This is a one-time bootstrap.

### User and Group

1. **User Management → Local Groups → Create** — name: `genomics-group`.
2. **User Management → Local Users → Create** — name: `genomics-user`, leading group: `data-engine-group`, additional group: `genomics-group`.
3. On the `genomics-user` row, click **Generate S3 Key** and copy the **Access Key** and **Secret Key** — they go into both `genomics-ingest.yaml` and the K8s application `values.yaml`.

### Identity Policy

The application needs S3 read/write on the file buckets and `s3:Tabular*` on the VastDB bucket — the Query Engine and vector similarity search (`array_cosine_distance`) both run through the `s3:Tabular*` action family; there is no separate `QueryEngine` or `vector` action.

**Steps:**

1. **User Management → Identity Policies → Create Identity Policy** — name: `genomics-policy`. Paste the JSON below and save.
2. Attach the policy to **both** `genomics-user` and `genomics-group` from the policy's **Attachments** tab (or via the **Identity Policies** tab on each user/group). Attaching to the group covers any future user added to it; attaching to the user directly guarantees the permissions take effect even if group resolution is delayed.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ListGenomicsBucket",
      "Effect": "Allow",
      "Action": ["s3:HeadBucket", "s3:ListBucket"],
      "Resource": ["arn:aws:s3:::genomics-data"]
    },
    {
      "Sid": "FullTabularAccessOnGenomicsDB",
      "Effect": "Allow",
      "Action": "s3:Tabular*",
      "Resource": [
        "arn:aws:s3:::genomics-data",
        "arn:aws:s3:::genomics-data/*"
      ]
    },
    {
      "Sid": "ObjectAccessForFilesAndLogs",
      "Effect": "Allow",
      "Action": "s3:*",
      "Resource": [
        "arn:aws:s3:::genomics-raw-data",
        "arn:aws:s3:::genomics-raw-data/*",
        "arn:aws:s3:::genomics-fastq-files",
        "arn:aws:s3:::genomics-fastq-files/*",
        "arn:aws:s3:::genomics-vcf-outputs",
        "arn:aws:s3:::genomics-vcf-outputs/*"
      ]
    }
  ]
}
```

**What each statement grants:**

| Sid | Scope | Permission |
|---|---|---|
| `ListGenomicsBucket` | `genomics-data` bucket | `HeadBucket` + `ListBucket` — required by the VastDB SDK / ADBC driver to resolve the database before any Tabular call |
| `FullTabularAccessOnGenomicsDB` | `genomics-data` schema and tables | Full `s3:Tabular*` — CRUD on `patients`, `samples`, `jobs`, `variants`, plus `TabularQueryData` used by `array_cosine_distance` vector search |
| `ObjectAccessForFilesAndLogs` | `genomics-raw-data`, `genomics-fastq-files`, `genomics-vcf-outputs` | Full S3 read/write for FASTQ ingestion, VCF outputs, and archived K8s Job logs |

> Reference: [Managing Permissions for VAST Tabular Databases](https://kb.vastdata.com/documentation/docs/managing-permissions-for-accessing-vast-tabular-databases-3), [Vector Search](https://kb.vastdata.com/documentation/docs/vector-search), [VAST Query Engine](https://kb.vastdata.com/documentation/docs/vast-query-engine-1).

### S3 Buckets

Under **Storage → Views → Create View**, create one view per bucket with these settings:

| Bucket name | Protocol | Bucket owner | View policy |
|---|---|---|---|
| `genomics-raw-data` | **S3 BUCKET** | `genomics-user` | `s3_default_policy` |
| `genomics-fastq-files` | **S3 BUCKET** | `genomics-user` | `s3_default_policy` |
| `genomics-vcf-outputs` | **S3 BUCKET** | `genomics-user` | `s3_default_policy` |

`s3_default_policy` is the built-in permissive view policy — quickest path to a working pipeline. For a tighter setup, create a custom view policy that restricts each bucket to `genomics-user` / `genomics-group` only (the identity policy above already scopes the actual S3 actions).

### VastDB Bucket

Create one more view named `genomics-data` via **Storage → Views → Create View**, with **both** protocols enabled:

- Protocols: **S3 BUCKET** + **DATABASE**
- Bucket owner: `genomics-user`
- View policy: `s3_default_policy` (the identity policy above is what actually grants `s3:Tabular*` on this bucket)

Tables (`patients`, `samples`, `jobs`, `variants`) are created automatically on first write — no DDL required.

### Kafka Topic

Under **Database → VAST Database**, locate the cluster's Kafka broker and create a new topic named `genomics`.

---

## Step 2: Configure Secret

```bash
cp deployments/dataengine-genomics-pipeline/genomics-ingest-template.yaml \
   deployments/dataengine-genomics-pipeline/genomics-ingest.yaml
```

Edit `genomics-ingest.yaml`:

| Key | Description |
|---|---|
| `vast_access_key` / `vast_secret_key` | VAST S3/VastDB credentials |
| `s3endpoint` | VAST S3 endpoint |
| `vdbendpoint` | VastDB query engine endpoint |
| `vdbbucket` / `vdbschema` | `genomics-data` / `genomics` |
| `backend_url` | FastAPI backend endpoint (e.g., `http://backend.genomics.svc.cluster.local:8000`) |
| `processing_mode` | `mock` (default) or `gpu` |
| `use_api_catalog` | `true` = NVIDIA API Catalog, `false` = self-hosted NIM |
| `nvidia_api_key` | Required when `use_api_catalog: true` |
| `llm_model` | LLM model name |
| `llmhost` / `llmport` / `llmhttpscheme` | LLM NIM endpoint (`vcf-parser` clinical summaries) |
| `embeddinghost` / `embeddingport` / `embeddinghttpscheme` | Embedding NIM endpoint (`variant-processor` vectors) |

`genomics-ingest.yaml` is git-ignored — never commit credentials.

### Local NIM configuration

When deploying NIM in-cluster (`nim.enabled: true` in the K8s Helm chart), DataEngine functions reach the NIM services via in-cluster DNS. Set the following in `genomics-ingest.yaml`:

```yaml
use_api_catalog: false
nvidia_api_key: ""

llmhost: "nim-llm.genomics.svc.cluster.local"
llmport: "8000"
llmhttpscheme: "http"

embeddinghost: "nim-embed.genomics.svc.cluster.local"
embeddingport: "8000"
embeddinghttpscheme: "http"
```

DataEngine Knative functions run inside the same cluster and can reach ClusterIP services in any namespace via their full DNS name.

---

## Step 3: Create Triggers

Navigate to **DataEngine UI → Triggers** and create:

| Trigger name | Source bucket | Event | Topic |
|---|---|---|---|
| `genomics-fastq-trigger` | `genomics-fastq-files` | `s3:ObjectCreated:*` | `genomics` |
| `genomics-vcf-trigger` | `genomics-vcf-outputs` | `s3:ObjectCreated:*` | `genomics` |

---

## Step 4: Build and Push Function Images (Optional)

> **Optional** — prebuilt images are published to Docker Hub under `vastdatasolutions/genomic-engine-*` and are used directly in [Step 5](#step-5-create-functions). Skip this step unless you need to build from local source (e.g. for a custom fork or unreleased change).
>
> For the automated build flow, refer to [`.gitlab-ci.yml`](https://github.com/vast-data/genomic-engine/blob/main/.gitlab-ci.yml) — see the `.vastde-build-template` job and the per-function `build-fastq-registrar`, `build-vcf-parser`, `build-variant-processor` jobs for the exact `vastde` CLI invocation and tagging rules.

Ingest functions are built with the `vastde` CLI using Cloud Native Buildpacks — no Dockerfile needed.

**Install vastde CLI:**

```bash
curl -fsSL -o vastde \
  https://github.com/vast-data/dataengine-cli/releases/download/v5.4.1-dev.c0b8b3d5/vastde_linux_amd64
chmod +x vastde && sudo mv vastde /usr/local/bin
vastde config set --builder-image-url vastdataorg/vast-builder:v5.4.1-dev.29d4871e
```

CLI releases: https://github.com/vast-data/dataengine-cli/releases

**Build and push:**

```bash
cd source-code/ingest/fastq-registrar
vastde functions build genomic-engine-fastq-registrar
docker tag genomic-engine-fastq-registrar:latest vastdatasolutions/genomic-engine-fastq-registrar:<tag>
docker push vastdatasolutions/genomic-engine-fastq-registrar:<tag>

cd ../vcf-parser
vastde functions build genomic-engine-vcf-parser
docker tag genomic-engine-vcf-parser:latest vastdatasolutions/genomic-engine-vcf-parser:<tag>
docker push vastdatasolutions/genomic-engine-vcf-parser:<tag>

cd ../variant-processor
vastde functions build genomic-engine-variant-processor
docker tag genomic-engine-variant-processor:latest vastdatasolutions/genomic-engine-variant-processor:<tag>
docker push vastdatasolutions/genomic-engine-variant-processor:<tag>
```

Builds are also automated in GitLab CI using the `.vastde-build-template`. CI/CD variables `DOCKER_USER` and `DOCKER_TOKEN` must be set as masked variables.

---

## Step 5: Create Functions

Navigate to **DataEngine UI → Functions** and create:

| Function name | Image |
|---|---|
| `genomics-fastq-registrar` | `vastdatasolutions/genomic-engine-fastq-registrar:latest` |
| `genomics-vcf-parser` | `vastdatasolutions/genomic-engine-vcf-parser:latest` |
| `genomics-variant-processor` | `vastdatasolutions/genomic-engine-variant-processor:latest` |

Upload `genomics-ingest.yaml` as the shared secret (name: `genomicsecret`) for all three functions.

---

## Step 6: Create Pipeline

Navigate to **DataEngine UI → Pipelines → Create** and configure:

**Name:** `genomics-pipeline`

**Connections:**
1. `genomics-fastq-trigger` → `genomics-fastq-registrar`
2. `genomics-vcf-trigger` → `genomics-vcf-parser` → `genomics-variant-processor`

---

## Function Documentation

| Function | Source | Description |
|---|---|---|
| `genomics-fastq-registrar` | [fastq-registrar](../../source-code/ingest/fastq-registrar/README.md) | Triggered on FASTQ upload; submits K8s Job, updates sample status |
| `genomics-vcf-parser` | [vcf-parser](../../source-code/ingest/vcf-parser/README.md) | Parses VCF, ClinVar enrichment, LLM summaries, memoization |
| `genomics-variant-processor` | [variant-processor](../../source-code/ingest/variant-processor/README.md) | NVIDIA NIM embeddings, bulk insert into VastDB |

---

## Switching Processing Mode

Update `processing_mode` in `genomics-ingest.yaml`, re-upload the secret in the DataEngine UI, then force a new Knative revision on `genomics-fastq-registrar`:

```bash
# Find the Knative service name
kubectl get ksvc -n default | grep genomics

# Force new revision (replace <ksvc-name> with the actual name)
kubectl patch ksvc <ksvc-name> -n default --type json -p '[
  {"op":"replace","path":"/spec/template/spec/containers/0/image","value":"docker.io/vastdatasolutions/genomic-engine-fastq-registrar:dev"},
  {"op":"add","path":"/spec/template/metadata/annotations/force-update","value":"'"$(date +%s)"'"}
]'
```

Use `--type json` (not `--type merge`) to avoid overwriting volume mounts.

Also update `processing_mode` in `deployments/genomics-k8s-application/values.yaml` and redeploy the K8s application.

---

## Checklist

- [ ] Group `genomics-group` created
- [ ] User `genomics-user` created (leading group: `data-engine-group`, additional: `genomics-group`)
- [ ] S3 key pair generated for `genomics-user`
- [ ] S3 identity policy `genomics-policy` created and attached to **both** `genomics-user` and `genomics-group` (S3 buckets + `s3:Tabular*` on `genomics-data`)
- [ ] S3 bucket `genomics-raw-data` created
- [ ] S3 bucket `genomics-fastq-files` created
- [ ] S3 bucket `genomics-vcf-outputs` created
- [ ] Bucket `genomics-data` created with S3 BUCKET + DATABASE protocols
- [ ] Kafka topic `genomics` created
- [ ] Trigger `genomics-fastq-trigger` created
- [ ] Trigger `genomics-vcf-trigger` created
- [ ] Functions `genomics-fastq-registrar`, `genomics-vcf-parser`, `genomics-variant-processor` deployed with `genomicsecret`
- [ ] Pipeline `genomics-pipeline` created with chaining configured
- [ ] `DOCKER_USER` and `DOCKER_TOKEN` set as masked CI/CD variables
