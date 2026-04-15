#!/usr/bin/env bash
# Download Parabricks sample data (includes hg38 reference) and prepare refs for the workflow.
#
# The Argo workflow expects: /data/refs/hg38.fa (and .fai etc.) on the volume
# mounted at /data (vast-pvc-genomics). Run this on a host that has access to
# the same storage, or copy the resulting refs/ directory into your PVC.
#
# Usage:
#   REF_DEST=/mnt/genomics ./scripts/prepare-ref-hg38.sh
#   (REF_DEST defaults to ./parabricks-refs if unset)
#
set -e

REF_DEST="${REF_DEST:-./parabricks-refs}"
SAMPLE_TAR="${REF_DEST}/parabricks_sample.tar.gz"
SAMPLE_DIR="${REF_DEST}/parabricks_sample"
REFS_DIR="${REF_DEST}/refs"

echo "[INFO] Reference destination: ${REF_DEST}"

mkdir -p "$REF_DEST"
cd "$REF_DEST"

if [[ ! -f "$SAMPLE_TAR" ]]; then
  echo "[INFO] Downloading Parabricks sample data (~9.3 GB)..."
  wget -O "$SAMPLE_TAR" "https://s3.amazonaws.com/parabricks.sample/parabricks_sample.tar.gz"
else
  echo "[INFO] Using existing $SAMPLE_TAR"
fi

if [[ ! -d "$SAMPLE_DIR" ]]; then
  echo "[INFO] Extracting..."
  tar -xzf "$SAMPLE_TAR"
fi

mkdir -p "$REFS_DIR"
if [[ ! -f "$REFS_DIR/hg38.fa" ]]; then
  echo "[INFO] Preparing hg38.fa for workflow..."
  cp "${SAMPLE_DIR}/Ref/Homo_sapiens_assembly38.fasta" "${REFS_DIR}/hg38.fa"
  [[ -f "${SAMPLE_DIR}/Ref/Homo_sapiens_assembly38.fasta.fai" ]] && \
    cp "${SAMPLE_DIR}/Ref/Homo_sapiens_assembly38.fasta.fai" "${REFS_DIR}/hg38.fa.fai"
  for ext in dict amb bwt sa pac ann; do
    src="${SAMPLE_DIR}/Ref/Homo_sapiens_assembly38.${ext}"
    [[ -f "$src" ]] && cp "$src" "${REFS_DIR}/hg38.fa.${ext}"
  done
  echo "[INFO] Refs ready in ${REFS_DIR}/"
else
  echo "[INFO] ${REFS_DIR}/hg38.fa already present."
fi

echo ""
echo "Next: copy ${REFS_DIR}/ to the path mounted as /data in Argo workflow pods,"
echo "so that /data/refs/hg38.fa exists (e.g. into vast-pvc-genomics)."
echo "  Example: kubectl cp or rsync to a node/pod that mounts the PVC, then mv refs /data/"
