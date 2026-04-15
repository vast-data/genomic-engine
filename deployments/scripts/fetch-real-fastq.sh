#!/usr/bin/env bash
# Fetch a real FASTQ for GPU/Parabricks testing and optionally upload to VAST S3.
#
# Usage:
#   ./scripts/fetch-real-fastq.sh [SRA_RUN_ID]
#   SRA_RUN_ID  Optional. Default: SRR292678 (small Illumina run, ~50MB gzipped)
#
# Requires: SRA Toolkit (prefetch, fasterq-dump) installed and in PATH.
#   Install: https://github.com/ncbi/sra-tools/wiki/02.-Installing-SRA-Toolkit
#   Or: conda install -c bioconda sra-tools
#
# Optional upload to genomics-raw-data (set before running):
#   export S3_ENDPOINT="http://<your-vip-pool>"
#   export AWS_ACCESS_KEY_ID="<your-key>"
#   export AWS_SECRET_ACCESS_KEY="<your-secret>"
#   export UPLOAD_S3_KEY="incoming/NA12878_real_R1.fastq.gz"   # optional key name
#
set -e

SRA_ID="${1:-SRR292678}"
OUT_DIR="${OUT_DIR:-./real-fastq}"
OUT_R1="${OUT_DIR}/${SRA_ID}_R1.fastq.gz"
OUT_R2="${OUT_DIR}/${SRA_ID}_R2.fastq.gz"

echo "[INFO] SRA run: ${SRA_ID}"
echo "[INFO] Output dir: ${OUT_DIR}"

if ! command -v prefetch &>/dev/null || ! command -v fasterq-dump &>/dev/null; then
  echo "[ERROR] SRA Toolkit not found. Install with:"
  echo "  conda install -c bioconda sra-tools"
  echo "  or see https://github.com/ncbi/sra-tools/wiki/02.-Installing-SRA-Toolkit"
  echo ""
  echo "Alternatively, download real FASTQ manually:"
  echo "  - GIAB NA12878: ftp://ftp-trace.ncbi.nlm.nih.gov/ReferenceSamples/giab/data/NA12878/Garvan_NA12878_HG001_HiSeq_Exome/"
  echo "  - SRA: https://www.ncbi.nlm.nih.gov/sra → choose a run → use SRA Run Selector or fastq-dump"
  exit 1
fi

mkdir -p "$OUT_DIR"
cd "$OUT_DIR"

if [[ -f "$OUT_R1" ]]; then
  echo "[INFO] Already have ${OUT_R1}; skip download unless you delete it."
else
  echo "[INFO] Prefetching ${SRA_ID}..."
  prefetch "$SRA_ID" --output-file "${SRA_ID}.sra"
  echo "[INFO] Dumping to FASTQ..."
  fasterq-dump "$SRA_ID" --split-files --skip-technical --threads 4
  echo "[INFO] Compressing..."
  gzip -f "${SRA_ID}_1.fastq" 2>/dev/null || true
  gzip -f "${SRA_ID}_2.fastq" 2>/dev/null || true
  mv "${SRA_ID}_1.fastq.gz" "$OUT_R1" 2>/dev/null || mv "${SRA_ID}.fastq.gz" "$OUT_R1" 2>/dev/null || true
  [[ -f "${SRA_ID}_2.fastq" ]] && gzip -f "${SRA_ID}_2.fastq" && mv "${SRA_ID}_2.fastq.gz" "$OUT_R2"
  rm -f "${SRA_ID}.sra"
fi

echo "[INFO] R1 FASTQ: ${OUT_R1} ($(du -h "$OUT_R1" | cut -f1))"

if [[ -n "$S3_ENDPOINT" && -n "$AWS_ACCESS_KEY_ID" && -n "$AWS_SECRET_ACCESS_KEY" ]]; then
  KEY="${UPLOAD_S3_KEY:-incoming/$(basename "$OUT_R1")}"
  echo "[INFO] Uploading to s3://genomics-raw-data/${KEY}"
  aws s3 cp "$OUT_R1" "s3://genomics-raw-data/${KEY}" --endpoint-url "$S3_ENDPOINT"
  echo "[INFO] Source path for UI: s3://genomics-raw-data/${KEY}"
else
  echo "[INFO] Set S3_ENDPOINT, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY to upload to VAST."
fi
