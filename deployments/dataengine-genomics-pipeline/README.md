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

## Step 4: Build and Push Function Images

> Builds are fully automated in GitLab CI — see the `.vastde-build-template` and the per-function `build-fastq-registrar`, `build-vcf-parser`, `build-variant-processor` jobs in the project's [`.gitlab-ci.yml`](../../.gitlab-ci.yml). The steps below are the manual equivalent for local builds or one-off pushes to a custom registry.

Ingest functions are built with the `vastde` CLI using Cloud Native Buildpacks — no Dockerfile required.

**Prerequisites:** a running Docker daemon (the `vastde` builder shells out to `docker`) and `curl`.

**Install the `vastde` CLI and seed its config** (one-time setup). The CLI and builder versions must match the target VAST cluster — the example below pins the pair currently used in CI for **VAST 5.4**:

```bash
# 1. Download the CLI binary
curl -fsSL -o vastde \
  https://github.com/vast-data/dataengine-cli/releases/download/v5.4.1-dev.c0b8b3d5/vastde_linux_amd64
chmod +x vastde && sudo mv vastde /usr/local/bin

# 2. Write the CLI config. `vastde functions build` reads the builder image URL
#    from here; the auth / VMS fields can stay empty for local builds (they are
#    only used when the CLI talks to a live VMS).
mkdir -p ~/.vast
cat > ~/.vast/config.toml << 'EOF'
[auth]
password = ''
tenant = ''
username = ''

[servers]
builder_image_url = 'vastdataorg/vast-builder:v5.4.1-dev.29d4871e'
vms_url = ''
EOF

# 3. Sanity check
vastde version
```

The exact pair used by CI is declared at the top of [`.gitlab-ci.yml`](../../.gitlab-ci.yml) (`VASTDE_CLI_VERSION`, `VASTDE_BUILDER_TAG`) — keep your local install in sync with those values, and bump both when targeting a newer VAST version. CLI release list: https://github.com/vast-data/dataengine-cli/releases.

> Running inside a CI container? See the `.vastde-build-template` job in `.gitlab-ci.yml` for the equivalent setup with Docker‑in‑Docker (writes the same `config.toml` to `/root/.vast/`).

**Generic build & push pattern** — the same flow applies to all three ingest functions; only the source directory and component name change:

```bash
cd source-code/ingest/<function>          # fastq-registrar | vcf-parser | variant-processor
vastde functions build genomic-engine-<function>
docker tag  genomic-engine-<function>:latest <your-registry>/genomic-engine-<function>:<tag>
docker push <your-registry>/genomic-engine-<function>:<tag>
```

For example, building and pushing the FASTQ registrar:

```bash
cd source-code/ingest/fastq-registrar
vastde functions build genomic-engine-fastq-registrar
docker tag  genomic-engine-fastq-registrar:latest <your-registry>/genomic-engine-fastq-registrar:<tag>
docker push <your-registry>/genomic-engine-fastq-registrar:<tag>
```

Repeat for `vcf-parser` (from `source-code/ingest/vcf-parser`) and `variant-processor` (from `source-code/ingest/variant-processor`).

> CI authenticates to the registry using the `DOCKER_USER` / `DOCKER_TOKEN` masked CI/CD variables — for local builds run `docker login <your-registry>` once before pushing.

---

## Step 5: Create Functions

Navigate to **DataEngine UI → Functions** and create one function per row, referencing the image you pushed in [Step 4](#step-4-build-and-push-function-images) (or the prebuilt image from your chosen registry):

| Function name | Image |
|---|---|
| `genomics-fastq-registrar` | `<your-registry>/genomic-engine-fastq-registrar:<tag>` |
| `genomics-vcf-parser` | `<your-registry>/genomic-engine-vcf-parser:<tag>` |
| `genomics-variant-processor` | `<your-registry>/genomic-engine-variant-processor:<tag>` |

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

# Force new revision (replace <ksvc-name> with the actual name, and the image
# with the one pushed in Step 4 — e.g. <your-registry>/genomic-engine-fastq-registrar:<tag>)
kubectl patch ksvc <ksvc-name> -n default --type json -p '[
  {"op":"replace","path":"/spec/template/spec/containers/0/image","value":"<your-registry>/genomic-engine-fastq-registrar:<tag>"},
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
