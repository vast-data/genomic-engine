import json
import logging
from typing import Optional, List, Dict, Any
from urllib.parse import quote

import requests

from src.config import settings
from src.services.retry import call_with_retry

RCSB_SEARCH_URL = "https://search.rcsb.org/rcsbsearch/v2/query"
RCSB_FILE_URL = "https://files.rcsb.org/download"
PUBCHEM_URL = "https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name"

logger = logging.getLogger(__name__)


class BioNeMoService:
    def __init__(self):
        self.api_key = settings.nvidia.api_key
        self.molmim_url = settings.bionemo.molmim_url
        self.diffdock_url = settings.bionemo.diffdock_url
        self._smiles_cache: Dict[str, str] = {}
        self._molecule_cache: Dict[str, Dict[str, Any]] = {}
        self._pdb_cache: Dict[str, str] = {}
        self._structure_cache: Dict[str, List[Dict[str, Any]]] = {}

    def lookup_smiles(self, drug_name: str) -> Optional[str]:
        normalized = drug_name.strip().lower()
        if normalized in self._smiles_cache:
            return self._smiles_cache[normalized]

        try:
            url = f"{PUBCHEM_URL}/{quote(drug_name)}/property/CanonicalSMILES/JSON"
            response = call_with_retry(
                lambda: requests.get(url, timeout=10),
                operation=f"PUBCHEM:lookup_smiles:{drug_name}",
            )
            response.raise_for_status()
            data = response.json()
            props = data.get("PropertyTable", {}).get("Properties", [])
            if props:
                entry = props[0]
                smiles = next(
                    (v for k, v in entry.items() if k != "CID" and isinstance(v, str)),
                    None,
                )
                if smiles:
                    self._smiles_cache[normalized] = smiles
                    return smiles
        except Exception as e:
            logger.warning(f"PubChem lookup failed for '{drug_name}': {e}")

        return None

    def generate_molecules(
        self,
        smiles: str,
        num_molecules: int = 10,
        min_similarity: float = 0.3,
    ) -> Dict[str, Any]:
        if smiles in self._molecule_cache:
            return self._molecule_cache[smiles]

        payload = {
            "algorithm": "CMA-ES",
            "smi": smiles,
            "num_molecules": min(num_molecules, 100),
            "iterations": 10,
            "property_name": "QED",
            "particles": 30,
            "minimize": False,
            "min_similarity": min_similarity,
            "scaled_radius": 1,
        }

        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.api_key}",
        }

        try:
            response = call_with_retry(
                lambda: requests.post(
                    self.molmim_url,
                    json=payload,
                    headers=headers,
                    timeout=120,
                ),
                operation="MOLMIM:generate",
            )
            response.raise_for_status()
            body = response.json()

            raw_molecules = body.get("molecules", "[]")
            if isinstance(raw_molecules, str):
                molecules = json.loads(raw_molecules)
            else:
                molecules = raw_molecules

            molecules.sort(key=lambda m: m.get("score", 0), reverse=True)

            result = {
                "seed_smiles": smiles,
                "molecules": molecules,
                "score_type": body.get("score_type", "tanimoto_similarity"),
            }

            self._molecule_cache[smiles] = result
            return result

        except requests.HTTPError as e:
            logger.error(f"MolMIM API error: {e} | Response: {e.response.text if e.response else 'N/A'}")
            raise
        except Exception as e:
            logger.error(f"MolMIM generation failed: {e}")
            raise

    def fetch_pdb(self, pdb_id: str) -> Optional[str]:
        pdb_id = pdb_id.strip().upper()
        if pdb_id in self._pdb_cache:
            return self._pdb_cache[pdb_id]

        try:
            url = f"{RCSB_FILE_URL}/{pdb_id}.pdb"
            response = call_with_retry(
                lambda: requests.get(url, timeout=30),
                operation=f"RCSB:fetch_pdb:{pdb_id}",
            )
            response.raise_for_status()
            content = response.text
            self._pdb_cache[pdb_id] = content
            logger.info(f"Fetched PDB {pdb_id} ({len(content)} bytes)")
            return content
        except Exception as e:
            logger.error(f"PDB fetch failed for {pdb_id}: {e}")
            return None

    def lookup_structures(self, gene: str) -> List[Dict[str, Any]]:
        gene_upper = gene.strip().upper()
        if gene_upper in self._structure_cache:
            return self._structure_cache[gene_upper]

        query_payload = {
            "query": {
                "type": "group",
                "logical_operator": "and",
                "nodes": [
                    {
                        "type": "terminal",
                        "service": "text",
                        "parameters": {
                            "attribute": "rcsb_entity_source_organism.rcsb_gene_name.value",
                            "operator": "exact_match",
                            "value": gene_upper,
                        },
                    },
                    {
                        "type": "terminal",
                        "service": "text",
                        "parameters": {
                            "attribute": "entity_poly.rcsb_entity_polymer_type",
                            "operator": "exact_match",
                            "value": "Protein",
                        },
                    },
                ],
            },
            "request_options": {
                "paginate": {"start": 0, "rows": 20},
                "results_content_type": ["experimental"],
                "sort": [{"sort_by": "rcsb_accession_info.initial_release_date", "direction": "desc"}],
            },
            "return_type": "entry",
        }

        try:
            response = call_with_retry(
                lambda: requests.post(RCSB_SEARCH_URL, json=query_payload, timeout=15),
                operation=f"RCSB:lookup_structures:{gene_upper}",
            )
            response.raise_for_status()
            data = response.json()

            pdb_ids = [hit.get("identifier", "") for hit in data.get("result_set", [])]
            if not pdb_ids:
                self._structure_cache[gene_upper] = []
                return []

            structures = self._fetch_structure_metadata(pdb_ids[:15])
            self._structure_cache[gene_upper] = structures
            return structures
        except Exception as e:
            logger.warning(f"RCSB structure lookup failed for gene {gene}: {e}")
            return []

    def _fetch_structure_metadata(self, pdb_ids: List[str]) -> List[Dict[str, Any]]:
        results = []
        for pdb_id in pdb_ids:
            try:
                url = f"https://data.rcsb.org/rest/v1/core/entry/{pdb_id}"
                response = call_with_retry(
                    lambda: requests.get(url, timeout=10),
                    operation=f"RCSB:metadata:{pdb_id}",
                )
                response.raise_for_status()
                entry = response.json()

                method = "Unknown"
                resolution = None
                exptl = entry.get("exptl", [])
                if exptl:
                    method = exptl[0].get("method", "Unknown")
                refine = entry.get("refine", [])
                if refine:
                    resolution = refine[0].get("ls_d_res_high")

                title = entry.get("struct", {}).get("title", "")

                results.append({
                    "pdb_id": pdb_id,
                    "method": method,
                    "resolution": float(resolution) if resolution else None,
                    "title": title,
                })
            except Exception as e:
                logger.warning(f"Metadata fetch failed for PDB {pdb_id}: {e}")
                results.append({"pdb_id": pdb_id, "method": "Unknown", "resolution": None, "title": ""})
        return results

    def dock_molecule(
        self,
        pdb_id: str,
        ligand_smiles: str,
        num_poses: int = 5,
    ) -> Dict[str, Any]:
        protein_pdb_full = self.fetch_pdb(pdb_id)
        if not protein_pdb_full:
            raise ValueError(f"Could not fetch PDB structure for {pdb_id}")

        protein_atoms = "\n".join(
            line for line in protein_pdb_full.split("\n") if line.startswith("ATOM")
        )

        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.api_key}",
        }

        payload = {
            "ligand": ligand_smiles,
            "ligand_file_type": "txt",
            "protein": protein_atoms,
            "num_poses": num_poses,
            "time_divisions": 20,
            "steps": 18,
            "save_trajectory": False,
        }

        try:
            response = call_with_retry(
                lambda: requests.post(
                    self.diffdock_url,
                    headers=headers,
                    json=payload,
                    timeout=300,
                ),
                operation=f"DIFFDOCK:dock:{pdb_id}",
            )
            response.raise_for_status()
            result = response.json()

            best_score = 0.0
            best_sdf = ""
            pose_metadata = []

            if isinstance(result, dict):
                position_confidence = result.get("position_confidence", [])
                ligand_positions = result.get("ligand_positions", [])

                for i, confidence in enumerate(position_confidence):
                    conf_val = float(confidence)
                    sdf_content = ligand_positions[i] if i < len(ligand_positions) else ""
                    pose_metadata.append({"rank": i + 1, "confidence": conf_val})
                    if conf_val > best_score or i == 0:
                        best_score = conf_val
                        best_sdf = sdf_content if isinstance(sdf_content, str) else ""

            return {
                "pdb_id": pdb_id,
                "ligand_smiles": ligand_smiles,
                "best_score": best_score,
                "best_pose_sdf": best_sdf,
                "poses_json": json.dumps(pose_metadata),
                "protein_pdb": protein_atoms,
                "num_poses": len(pose_metadata),
            }

        except requests.HTTPError as e:
            logger.error(f"DiffDock API error: {e} | Response: {e.response.text if e.response else 'N/A'}")
            raise
        except Exception as e:
            logger.error(f"DiffDock docking failed: {e}")
            raise
