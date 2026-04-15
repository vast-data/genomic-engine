from typing import Optional

from fastapi import APIRouter, Query, HTTPException

from src.services.vastdb_service import VastDBService

router = APIRouter()
vastdb = VastDBService()


@router.get("/{patient_id}")
async def get_patient(patient_id: str):
    patient = vastdb.get_patient(patient_id)
    samples = vastdb.get_patient_samples(patient_id)
    variants = vastdb.get_patient_variants(patient_id)

    return {
        "patient_id": patient_id,
        "demographics": patient,
        "sample_count": len(samples),
        "variant_count": len(variants),
        "samples": samples,
    }


@router.get("/{patient_id}/variants")
async def get_patient_variants(
    patient_id: str,
    gene: Optional[str] = Query(None),
    chromosome: Optional[str] = Query(None),
):
    variants = vastdb.get_patient_variants(
        patient_id,
        gene_filter=gene,
        chromosome_filter=chromosome,
    )

    def get_priority(variant):
        sig = str(variant.get("clinical_significance", "")).lower()
        if "pathogenic" in sig and "likely" not in sig:
            return 10
        elif "likely pathogenic" in sig:
            return 9
        elif any(k in sig for k in ["drug response", "risk factor", "association", "protective"]):
            return 8
        elif "conflicting" in sig:
            return 7
        elif "uncertain significance" in sig:
            return 6
        elif "unknown" in sig or "not provided" in sig:
            return 5
        elif "likely benign" in sig:
            return 4
        elif "benign" in sig:
            return 3
        elif sig:
            return 2
        return 0

    variants.sort(key=lambda x: (get_priority(x), x.get("quality", 0.0)), reverse=True)

    # Optional: we could include cache_hits_count directly in the returned variants 
    # since it's now queried by get_patient_variants.

    return {
        "patient_id": patient_id,
        "total": len(variants),
        "variants": variants,
    }
