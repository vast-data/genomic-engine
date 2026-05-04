import json
import logging
import time
from datetime import datetime, timezone
from typing import Optional, List, Dict, Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from src.config import settings
from src.services.vastdb_service import VastDBService
from src.services.embedding_service import EmbeddingService
from src.services.llm_service import LLMService
from src.services.bionemo_service import BioNeMoService
from src.services.s3_service import S3Service

logger = logging.getLogger(__name__)

router = APIRouter()
vastdb = VastDBService()
embedder = EmbeddingService()
llm = LLMService()
bionemo = BioNeMoService()
s3 = S3Service()


DOCKING_RESULTS_BUCKET = settings.s3.vcf_bucket
DOCKING_RESULTS_PREFIX = "docking"


def _docking_key(molecule_id: str, pdb_id: str, filename: str) -> str:
    return f"{DOCKING_RESULTS_PREFIX}/{molecule_id}/{pdb_id}/{filename}"


def _is_s3_uri(value: Optional[str]) -> bool:
    return isinstance(value, str) and value.startswith("s3://")


def _read_s3_text(uri: str) -> str:
    try:
        return s3.get_object_by_uri(uri)
    except Exception as e:
        logger.warning(f"S3 fetch failed for {uri}: {e}")
        return ""


def _materialize_docking_blobs(mol: Dict[str, Any]) -> None:
    sdf_value = mol.get("docking_poses_sdf") or ""
    pdb_value = mol.get("protein_pdb_content") or ""
    if _is_s3_uri(sdf_value):
        mol["docking_poses_sdf"] = _read_s3_text(sdf_value)
    if _is_s3_uri(pdb_value):
        mol["protein_pdb_content"] = _read_s3_text(pdb_value)


def _strip_docking_blobs(mol: Dict[str, Any]) -> None:
    if _is_s3_uri(mol.get("docking_poses_sdf")):
        mol["docking_poses_sdf"] = ""
    if _is_s3_uri(mol.get("protein_pdb_content")):
        mol["protein_pdb_content"] = ""


class SearchRequest(BaseModel):
    query: str
    limit: int = 20
    gene: Optional[str] = None
    quality: Optional[str] = None
    patient_id: Optional[str] = None
    clinical_significance: Optional[List[str]] = None
    synthesize: bool = False


class SearchResponse(BaseModel):
    query: str
    results: List[Dict[str, Any]]
    synthesis: Optional[str] = None
    total: int


class SynthesizeRequest(BaseModel):
    query: str
    variants: List[Dict[str, Any]]
    patient_id: Optional[str] = None
    quality: Optional[str] = None


class SynthesizeResponse(BaseModel):
    query: str
    synthesis: str
    elapsed_ms: int


class ExplainRequest(BaseModel):
    variant: Dict[str, Any]
    patient_data: Optional[Dict[str, Any]] = None

class ExplainResponse(BaseModel):
    explanation: str

class InsightsResponse(BaseModel):
    insights: str


class MoleculeRequest(BaseModel):
    drug_name: Optional[str] = None
    smiles: Optional[str] = None
    num_molecules: int = 10
    min_similarity: float = 0.3
    gene: Optional[str] = None
    variant_id: Optional[str] = None


class MoleculeResponse(BaseModel):
    seed_smiles: str
    drug_name: Optional[str] = None
    molecules: List[Dict[str, Any]]
    score_type: str
    source: str = "generated"


class DockRequest(BaseModel):
    molecule_id: str
    pdb_id: str
    num_poses: int = 5
    researcher_name: Optional[str] = None


class DockResponse(BaseModel):
    molecule_id: str
    pdb_id: str
    docking_score: float
    poses_count: int
    best_pose_sdf: str
    protein_pdb: str
    source: str = "computed"


class AnnotationRequest(BaseModel):
    researcher_name: str
    text: str
    action: str = "note"
    new_status: Optional[str] = None
    variant_id: Optional[str] = None
    gene: Optional[str] = None


@router.get("/search/variant/{variant_id}")
async def get_variant_by_id(variant_id: str):
    variant = vastdb.get_variant_by_id(variant_id)
    if not variant:
        raise HTTPException(status_code=404, detail="Variant not found")
    return variant


@router.post("/search/explain", response_model=ExplainResponse)
async def explain_variant(request: ExplainRequest):
    try:
        explanation = llm.explain_variant(request.variant)
        return ExplainResponse(explanation=explanation)
    except Exception as e:
        raise HTTPException(status_code=504, detail=f"LLM explanation timed out or failed: {e}")

@router.post("/search/insights", response_model=InsightsResponse)
async def get_insights(request: ExplainRequest):
    patient_data = request.patient_data
    if not patient_data and request.variant.get("patient_id"):
        try:
            patient_data = vastdb.get_patient(request.variant["patient_id"])
        except Exception:
            pass
    try:
        insights = llm.generate_insights(request.variant, patient_data)
        return InsightsResponse(insights=insights)
    except Exception as e:
        raise HTTPException(status_code=504, detail=f"LLM insights timed out or failed: {e}")


@router.post("/search/molecules", response_model=MoleculeResponse)
async def generate_molecules(request: MoleculeRequest):
    seed_smiles = request.smiles
    resolved_name = request.drug_name

    if not seed_smiles and not request.drug_name:
        raise HTTPException(status_code=400, detail="Provide either drug_name or smiles")

    if not seed_smiles:
        seed_smiles = bionemo.lookup_smiles(request.drug_name)
        if not seed_smiles:
            raise HTTPException(
                status_code=404,
                detail=(
                    f"'{request.drug_name}' was not found in PubChem. "
                    "This is likely a biologic (antibody/protein) rather than a small molecule. "
                    "MolMIM only works with small-molecule compounds. "
                    "Try a different drug or paste a SMILES string directly."
                ),
            )

    cached = vastdb.get_molecules_for_seed(seed_smiles)
    if cached:
        logger.info(f"Returning {len(cached)} cached molecules for seed {seed_smiles[:30]}...")
        molecules = []
        for row in cached:
            mol = {
                "sample": row["generated_smiles"],
                "score": row.get("tanimoto_score", 0.0),
                "molecule_id": row.get("molecule_id", ""),
                "variant_id": row.get("variant_id", ""),
                "gene": row.get("gene", ""),
                "status": row.get("status", "generated"),
                "docking_pdb_id": row.get("docking_pdb_id", ""),
                "docking_score": row.get("docking_score", 0.0),
                "docking_poses_sdf": row.get("docking_poses_sdf", ""),
                "docking_poses_json": row.get("docking_poses_json", ""),
                "protein_pdb_content": row.get("protein_pdb_content", ""),
            }
            _strip_docking_blobs(mol)
            annotations_raw = row.get("annotations", "[]")
            try:
                mol["annotations"] = json.loads(annotations_raw) if isinstance(annotations_raw, str) else (annotations_raw or [])
            except (json.JSONDecodeError, TypeError):
                mol["annotations"] = []
            molecules.append(mol)
        molecules.sort(key=lambda m: m.get("score", 0), reverse=True)
        return MoleculeResponse(
            seed_smiles=seed_smiles,
            drug_name=resolved_name,
            molecules=molecules,
            score_type="tanimoto_similarity",
            source="cached",
        )

    result = bionemo.generate_molecules(
        smiles=seed_smiles,
        num_molecules=request.num_molecules,
        min_similarity=request.min_similarity,
    )

    if result.get("molecules") and request.variant_id:
        saved = vastdb.save_molecules(
            seed_smiles=seed_smiles,
            seed_drug_name=resolved_name,
            molecules=result["molecules"],
            gene=request.gene or "",
            variant_id=request.variant_id,
        )
        logger.info(f"Persisted {saved} molecules for variant {request.variant_id}")

        for mol in result["molecules"]:
            gen_smiles = mol.get("sample", mol.get("smiles", ""))
            if gen_smiles:
                mol["molecule_id"] = VastDBService._molecule_id(seed_smiles, gen_smiles)

    return MoleculeResponse(
        seed_smiles=result["seed_smiles"],
        drug_name=resolved_name,
        molecules=result["molecules"],
        score_type=result["score_type"],
        source="generated",
    )


@router.get("/search/structures/{gene}")
async def lookup_structures(gene: str):
    structures = bionemo.lookup_structures(gene)
    return {"gene": gene, "structures": structures}


@router.post("/search/dock", response_model=DockResponse)
async def dock_molecule(request: DockRequest):
    molecule = vastdb.get_molecule(request.molecule_id)
    if not molecule:
        raise HTTPException(status_code=404, detail=f"Molecule {request.molecule_id} not found")

    gen_smiles = molecule["generated_smiles"]
    pdb_id = request.pdb_id.strip().upper()

    existing = vastdb.get_docking_result(gen_smiles, pdb_id)
    if existing:
        logger.info(f"Returning cached docking result for {gen_smiles[:30]}... + {pdb_id}")
        _materialize_docking_blobs(existing)
        return DockResponse(
            molecule_id=request.molecule_id,
            pdb_id=pdb_id,
            docking_score=existing.get("docking_score", 0.0),
            poses_count=len(json.loads(existing.get("docking_poses_json") or "[]")),
            best_pose_sdf=existing.get("docking_poses_sdf", ""),
            protein_pdb=existing.get("protein_pdb_content", ""),
            source="cached",
        )

    try:
        dock_result = bionemo.dock_molecule(
            pdb_id=pdb_id,
            ligand_smiles=gen_smiles,
            num_poses=request.num_poses,
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"DiffDock docking failed: {e}")

    try:
        poses_sdf_uri = s3.put_object(
            DOCKING_RESULTS_BUCKET,
            _docking_key(request.molecule_id, pdb_id, "best_pose.sdf"),
            dock_result["best_pose_sdf"] or "",
        )
        protein_pdb_uri = s3.put_object(
            DOCKING_RESULTS_BUCKET,
            _docking_key(request.molecule_id, pdb_id, "protein.pdb"),
            dock_result["protein_pdb"] or "",
        )
    except Exception as e:
        logger.exception("Failed to upload docking artefacts to S3")
        raise HTTPException(status_code=502, detail=f"Failed to persist docking artefacts to S3: {e}")

    try:
        vastdb.save_docking_result(
            molecule_id=request.molecule_id,
            pdb_id=pdb_id,
            score=dock_result["best_score"],
            poses_sdf_uri=poses_sdf_uri,
            poses_json=dock_result["poses_json"],
            protein_pdb_uri=protein_pdb_uri,
        )
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.exception("Failed to persist docking result to VastDB")
        raise HTTPException(status_code=502, detail=f"Failed to persist docking result: {e}")

    if request.researcher_name:
        vastdb.append_annotation(request.molecule_id, {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "researcher_name": request.researcher_name,
            "action": "docking_run",
            "text": f"Docked against PDB {pdb_id} (score: {dock_result['best_score']:.3f})",
            "variant_id": molecule.get("variant_id", ""),
            "gene": molecule.get("gene", ""),
        })

    return DockResponse(
        molecule_id=request.molecule_id,
        pdb_id=pdb_id,
        docking_score=dock_result["best_score"],
        poses_count=dock_result["num_poses"],
        best_pose_sdf=dock_result["best_pose_sdf"],
        protein_pdb=dock_result["protein_pdb"],
        source="computed",
    )


@router.get("/search/molecules/all")
async def get_all_molecules():
    molecules = vastdb.get_all_molecules()
    for mol in molecules:
        _strip_docking_blobs(mol)
        annotations_raw = mol.get("annotations", "[]")
        if isinstance(annotations_raw, str):
            try:
                mol["annotations"] = json.loads(annotations_raw)
            except (json.JSONDecodeError, TypeError):
                mol["annotations"] = []
    return {"molecules": molecules, "total": len(molecules)}


@router.get("/search/molecules/{molecule_id}/docking-blobs")
async def get_molecule_docking_blobs(molecule_id: str):
    molecule = vastdb.get_molecule(molecule_id)
    if not molecule:
        raise HTTPException(status_code=404, detail=f"Molecule {molecule_id} not found")
    if not molecule.get("docking_pdb_id"):
        raise HTTPException(status_code=404, detail="Molecule has no docking result")

    _materialize_docking_blobs(molecule)
    return {
        "molecule_id": molecule_id,
        "pdb_id": molecule.get("docking_pdb_id", ""),
        "docking_score": molecule.get("docking_score", 0.0),
        "best_pose_sdf": molecule.get("docking_poses_sdf", ""),
        "protein_pdb": molecule.get("protein_pdb_content", ""),
    }


@router.get("/search/molecules/{variant_id}")
async def get_variant_molecules(variant_id: str):
    molecules = vastdb.get_molecules_for_variant(variant_id)
    for mol in molecules:
        _strip_docking_blobs(mol)
        annotations_raw = mol.get("annotations", "[]")
        if isinstance(annotations_raw, str):
            try:
                mol["annotations"] = json.loads(annotations_raw)
            except (json.JSONDecodeError, TypeError):
                mol["annotations"] = []
    return {"variant_id": variant_id, "molecules": molecules, "total": len(molecules)}


@router.post("/search/molecules/{molecule_id}/annotate")
async def annotate_molecule(molecule_id: str, request: AnnotationRequest):
    annotation = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "researcher_name": request.researcher_name,
        "action": request.action,
        "text": request.text,
        "variant_id": request.variant_id or "",
        "gene": request.gene or "",
    }

    if request.action == "status_change" and request.new_status:
        molecule = vastdb.get_molecule(molecule_id)
        annotation["previous_status"] = molecule.get("status", "unknown") if molecule else "unknown"
        annotation["new_status"] = request.new_status

    success = vastdb.append_annotation(molecule_id, annotation)
    if not success:
        raise HTTPException(status_code=404, detail=f"Molecule {molecule_id} not found")

    return {"success": True, "molecule_id": molecule_id}


@router.get("/stats")
async def get_stats():
    patients = vastdb.get_all_patients()
    samples = vastdb.get_all_pipelines()
    jobs = vastdb.get_all_jobs()
    
    total_variants = sum((s.get("variant_count") or 0) for s in samples)
    
    # We now fetch all variants to compute total cache hits globally
    try:
        session = vastdb._connect()
        with session.transaction() as tx:
            table = vastdb._get_table(tx, "variants")
            if table:
                reader = table.select(columns=["cache_hits_count"])
                results = reader.read_all().to_pylist()
                total_cache_hits = sum(r.get("cache_hits_count", 0) for r in results)
            else:
                total_cache_hits = 0
    except Exception:
        total_cache_hits = 0
    
    ethnicities = {}
    total_age = 0
    age_count = 0
    for p in patients:
        eth = p.get("ethnicity", "Unknown")
        if eth:
            ethnicities[eth] = ethnicities.get(eth, 0) + 1
        age = p.get("age", 0)
        if age:
            total_age += age
            age_count += 1
            
    avg_age = round(total_age / age_count) if age_count > 0 else 0
    
    # Check jobs table since samples might still be in "processing" state 
    # if the DataEngine variant-processor hasn't finished yet.
    # Count ALL completed/succeeded jobs (including mock) as GPU accelerated runs.
    gpu_runs = sum(1 for j in jobs if j.get("status") in ["succeeded", "completed"])
    hours_saved = round(gpu_runs * 47.5)
    
    return {
        "total_patients": len(patients),
        "total_samples": len(samples),
        "total_variants": total_variants,
        "llm_api_calls_saved": total_cache_hits,
        "avg_patient_age": avg_age,
        "top_ethnicity": max(ethnicities, key=ethnicities.get) if ethnicities else "N/A",
        "compute_hours_saved": hours_saved,
        "gpu_accelerated_runs": gpu_runs
    }

@router.post("/search", response_model=SearchResponse)
async def search_variants(request: SearchRequest):
    t_start = time.perf_counter()
    logger.info(
        "[SEARCH] start query=%r limit=%d gene=%s patient=%s sig=%s quality=%s",
        request.query, request.limit, request.gene, request.patient_id,
        request.clinical_significance, request.quality,
    )

    t_embed = time.perf_counter()
    try:
        query_embedding = embedder.embed_query(request.query)
    except Exception as e:
        logger.exception("[SEARCH] embed failed query=%r", request.query)
        raise HTTPException(status_code=502, detail=f"Embedding service failed: {e}")
    embed_ms = int((time.perf_counter() - t_embed) * 1000)

    t_vss = time.perf_counter()
    results = vastdb.search_variants(
        query_embedding=query_embedding,
        limit=request.limit,
        gene_filter=request.gene,
        quality_filter=request.quality,
        patient_filter=request.patient_id,
        significance_filter=request.clinical_significance,
    )
    vss_ms = int((time.perf_counter() - t_vss) * 1000)

    total_ms = int((time.perf_counter() - t_start) * 1000)
    logger.info(
        "[SEARCH] done rows=%d embed_ms=%d vss_ms=%d total_ms=%d",
        len(results), embed_ms, vss_ms, total_ms,
    )

    return SearchResponse(
        query=request.query,
        results=results,
        synthesis=None,
        total=len(results),
    )


@router.post("/search/synthesize", response_model=SynthesizeResponse)
async def synthesize_search(request: SynthesizeRequest):
    if not request.variants:
        return SynthesizeResponse(
            query=request.query,
            synthesis="No relevant variants found for your query.",
            elapsed_ms=0,
        )

    logger.info(
        "[SYNTHESIZE] start query=%r variants=%d patient=%s",
        request.query, len(request.variants), request.patient_id,
    )
    t_start = time.perf_counter()
    try:
        synthesis = llm.synthesize(
            request.query, request.variants, request.patient_id, request.quality,
        )
    except Exception as e:
        elapsed_ms = int((time.perf_counter() - t_start) * 1000)
        logger.exception("[SYNTHESIZE] failed elapsed_ms=%d", elapsed_ms)
        raise HTTPException(status_code=504, detail=f"LLM synthesis failed: {e}")

    elapsed_ms = int((time.perf_counter() - t_start) * 1000)
    ok = not synthesis.startswith("LLM synthesis unavailable")
    logger.info("[SYNTHESIZE] done ok=%s elapsed_ms=%d", ok, elapsed_ms)

    if not ok:
        raise HTTPException(status_code=504, detail=synthesis)

    return SynthesizeResponse(
        query=request.query,
        synthesis=synthesis,
        elapsed_ms=elapsed_ms,
    )
