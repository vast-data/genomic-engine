# Mock Parabricks

A CPU-only substitute for NVIDIA Parabricks that generates deterministic synthetic VCF output — enabling full end-to-end pipeline testing without GPU nodes.

## What It Does

- Implements the `pbrun deepvariant_germline` subcommand interface expected by the K8s Job
- Selects 8 variants from a pool of ~150 clinically relevant loci (BRCA1, BRCA2, TP53, MSH2, EGFR, SPAST, and more)
- Writes a standards-compliant VCF with realistic allele frequencies (AF), read depths (DP), and DeepVariant quality scores (DVQ)
- Completes in seconds — no reference genome, no GPU, no bioinformatics tools required

## Easy to Adjust

Activate by setting `processing_mode: mock` in `deployments/genomics-k8s-application/values.yaml`.

The variant pool is defined as `PATHOGENIC_VARIANTS` at the top of `mock_pbrun.py`. Add, remove, or modify entries to change which synthetic variants are generated.

## About the Container

- **Triggered by**: K8s Job `compute-parabricks` init container (when `mock=true`)
- **Input**: FASTQ file path — content is ignored; any valid gzip file is accepted
- **Output**: VCF file written to the shared emptyDir volume, then uploaded to `genomics-vcf-outputs`
- **Subcommand**: `mock_pbrun.py deepvariant_germline --in-fq <fastq> --out-variants <vcf>`

## What Runs It

- **Runtime**: Kubernetes Job init container
- **Image**: `vastdatasolutions/genomic-engine-mock-parabricks:latest`
- **Dependencies**: Python 3.11 only
