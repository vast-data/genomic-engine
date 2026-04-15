# Variant Processor

A VAST DataEngine serverless function that embeds enriched variants and stores them in VastDB for semantic search.

## What It Does

- Receives enriched variant records from `genomics-vcf-parser` via function chaining
- Generates 2048-dimensional vector embeddings for each variant description using NVIDIA NIM
- Skips re-embedding for variants that already have cached vectors (from the memoization layer)
- Bulk-inserts variant records with embeddings into the VastDB `variants` table (batches of 50)
- Updates the sample record: status → `completed`, sets `vcf_path` and `variant_count`

## Easy to Adjust

Configure in `deployments/dataengine-genomics-pipeline/genomics-ingest.yaml`:

| Key | Description |
|---|---|
| `embeddinghost` / `embeddingport` / `embeddinghttpscheme` | Self-hosted NIM embedding endpoint |
| `embeddingmodel` | Embedding model (default: `nvidia/llama-3.2-nv-embedqa-1b-v2`) |
| `embeddingdimensions` | Vector dimensions — must match the model output (default: `2048`) |
| `use_api_catalog` | `true` = NVIDIA API Catalog, `false` = self-hosted NIM |
| `nvidia_api_key` | Required when `use_api_catalog: true` |

## About the Function

- **Trigger**: Receives events from `genomics-vcf-parser` via function chaining (Kafka topic `genomics`)
- **Input**: Enriched variant list with sample and patient IDs
- **Output**: Variant rows with `vectors` column written to VastDB; sample marked `completed`

## What Runs It

- **Runtime**: VAST DataEngine serverless runtime
- **Image**: `vastdatasolutions/genomic-engine-variant-processor:latest`
- **Build**: `vastde functions build` (Cloud Native Buildpacks — no Dockerfile)
- **Dependencies**: `vastdb`, `openai` (NIM-compatible client), Python 3.11
