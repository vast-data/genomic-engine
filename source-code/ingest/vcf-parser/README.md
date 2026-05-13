# VCF Parser

A VAST DataEngine serverless function that transforms raw VCF output into clinically enriched variant records.

## What It Does

- Triggered when a VCF file lands in the `genomics-vcf-outputs` bucket
- Downloads and parses the VCF, extracting INFO fields (DP, AF, DVQ) and gene annotations
- Queries **ClinVar** via MyVariant.info for clinical significance of each variant
- For pathogenic variants, generates **LLM-powered clinical summaries** via NVIDIA NIM
- **Memoization**: checks VastDB for known variants before making any external API calls — reuses cached descriptions and embeddings if already stored
- Passes the enriched variant list to `genomics-variant-processor` via function chaining

## Easy to Adjust

Configure in `deployments/dataengine-genomics-pipeline/genomics-ingest.yaml`:

| Key | Description |
|---|---|
| `use_api_catalog` | `true` = NVIDIA API Catalog, `false` = self-hosted NIM |
| `nvidia_api_key` | Required when `use_api_catalog: true` |
| `llm_model` | LLM model for variant summaries (default: `meta/llama-3.1-70b-instruct`) |
| `s3endpoint` | VAST S3 endpoint for VCF download |

## About the Function

- **Trigger**: S3 `ObjectCreated` on `genomics-vcf-outputs` (via Kafka topic `genomics`)
- **Input**: VCF file at `s3://genomics-vcf-outputs/{patient_id}/{sample_id}/{sample_id}.vcf`
- **Output**: Enriched variant list passed to `genomics-variant-processor` via chaining
- **Cache**: Variants already in VastDB skip ClinVar and LLM calls entirely

## What Runs It

- **Runtime**: VAST DataEngine serverless runtime
- **Image**: `<your-registry>/genomic-engine-vcf-parser:<tag>`
- **Build**: `vastde functions build` (Cloud Native Buildpacks — no Dockerfile)
- **Dependencies**: `vastdb`, `boto3`, `requests`, Python 3.11
