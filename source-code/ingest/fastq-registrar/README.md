# FASTQ Registrar

A VAST DataEngine serverless function that bridges the FASTQ landing bucket and Kubernetes compute.

## What It Does

- Triggered when a FASTQ file is created in the `genomics-fastq-files` bucket via S3 event
- Extracts patient and sample IDs from the S3 key path (`{patient_id}/{sample_id}/{filename}`)
- Submits a Kubernetes Job to the backend API (mock or GPU mode, based on `processing_mode`)
- Updates the sample status in VastDB to `processing`
- Skips non-FASTQ files and non-ObjectCreated events automatically

## Easy to Adjust

Configure in `deployments/dataengine-genomics-pipeline/genomics-ingest.yaml`:

| Key | Description |
|---|---|
| `processing_mode` | `mock` (CPU-only synthetic VCF) or `gpu` (real Parabricks) |
| `backend_url` | FastAPI backend endpoint for K8s Job submission |
| `vdbendpoint` / `vdbbucket` / `vdbschema` | VastDB connection for sample status updates |

## About the Function

- **Trigger**: S3 `ObjectCreated` on `genomics-fastq-files` (via Kafka topic `genomics`)
- **Input**: S3 event with key `{patient_id}/{sample_id}/{filename}`
- **Output**: K8s Job submitted; sample status set to `processing` in VastDB

## What Runs It

- **Runtime**: VAST DataEngine serverless runtime
- **Image**: `<your-registry>/genomic-engine-fastq-registrar:<tag>`
- **Build**: `vastde functions build` (Cloud Native Buildpacks — no Dockerfile)
- **Dependencies**: `vastdb`, `requests`, Python 3.11
