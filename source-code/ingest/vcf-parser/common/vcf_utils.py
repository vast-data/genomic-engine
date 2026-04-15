import requests
from typing import Dict, List, Any, Tuple

GENE_REGIONS: List[Tuple[str, int, int, str]] = [
    ("chr17", 41160000, 41280000, "BRCA1"),
    ("chr13", 32290000, 32400000, "BRCA2"),
    ("chr17", 7565000, 7590000, "TP53"),
    ("chr7", 55019000, 55212000, "EGFR"),
    ("chr12", 25204000, 25251000, "KRAS"),
    ("chr7", 140719000, 140924000, "BRAF"),
    ("chr3", 178866000, 178957000, "PIK3CA"),
    ("chr10", 89623000, 89729000, "PTEN"),
    ("chr5", 112043000, 112181000, "APC"),
    ("chr2", 29192000, 29921000, "ALK"),
    ("chr1", 115247000, 115260000, "NRAS"),
    ("chr4", 55095000, 55165000, "PDGFRA"),
    ("chr11", 532000, 536000, "HBB"),
    ("chr7", 117465000, 117716000, "CFTR"),
    ("chr11", 108093000, 108240000, "ATM"),
    ("chr16", 23603000, 23642000, "PALB2"),
    ("chr18", 48556000, 48612000, "SMAD4"),
    ("chr2", 47630000, 47790000, "MSH2"),
    ("chr3", 36993000, 37051000, "MLH1"),
    ("chr17", 59756000, 59941000, "BRIP1"),
    ("chr22", 29059000, 29138000, "CHEK2"),
    ("chr9", 21967000, 21995000, "CDKN2A"),
    ("chr10", 43572000, 43625000, "RET"),
    ("chr3", 10141000, 10154000, "VHL"),
    ("chr11", 32389000, 32435000, "WT1"),
    ("chr13", 48877000, 49057000, "RB1"),
    ("chr17", 7668000, 7688000, "CYP2D6"),
    ("chr2", 215593000, 215675000, "BARD1"),
]


def myvariant_lookup_batch(uncached_variants: List[Dict[str, Any]]) -> Dict[str, Any]:
    if not uncached_variants:
        return {}
    
    results = {}
    # First pass: try standard lookup by HGVS ID (works if VCF is HG19, which mock is)
    hgvs_ids = [v["hgvs_id"] for v in uncached_variants]
    batch_size = 1000
    
    missing_variants = []
    
    for i in range(0, len(hgvs_ids), batch_size):
        batch = hgvs_ids[i:i + batch_size]
        print(f"[MYVARIANT API] Pass 1: Querying batch of {len(batch)} variants by ID...")
        try:
            response = requests.post(
                "https://myvariant.info/v1/variant",
                data={"ids": ",".join(batch), "fields": "clinvar,snpeff,vcf"},
                timeout=30
            )
            if response.status_code == 200:
                data = response.json()
                for item, v in zip(data, uncached_variants[i:i+batch_size]):
                    query_id = item.get("query")
                    if query_id and not item.get("notfound"):
                        results[query_id] = item
                    else:
                        missing_variants.append(v)
                print(f"[MYVARIANT API] Pass 1: Found {len([d for d in data if not d.get('notfound')])} variants.")
        except Exception as e:
            print(f"[MYVARIANT API] Pass 1 lookup failed: {e}")
            missing_variants.extend(uncached_variants[i:i+batch_size])

    # Second pass: for missing variants, try querying by position (handles production HG38 VCFs)
    if missing_variants:
        for i in range(0, len(missing_variants), batch_size):
            batch = missing_variants[i:i+batch_size]
            positions = [str(v["position"]) for v in batch]
            print(f"[MYVARIANT API] Pass 2: Querying {len(batch)} missing variants by position (HG38 fallback)...")
            try:
                response = requests.post(
                    "https://myvariant.info/v1/query",
                    data={
                        "q": ",".join(positions), 
                        "scopes": "clinvar.hg38.start,vcf.position", 
                        "fields": "clinvar,snpeff,vcf"
                    },
                    timeout=30
                )
                if response.status_code == 200:
                    data = response.json()
                    found_count = 0
                    for item in data:
                        if item.get("notfound"):
                            continue
                            
                        # We must verify the chromosome matches since multiple variants can share a position
                        clinvar = item.get("clinvar", {})
                        vcf = item.get("vcf", {})
                        
                        # Extract chrom and alt from the document to verify
                        doc_chrom = ""
                        if "hg38" in clinvar:
                            hg38 = clinvar["hg38"]
                            if isinstance(hg38, list) and len(hg38) > 0:
                                doc_chrom = str(hg38[0].get("chrom", ""))
                            elif isinstance(hg38, dict):
                                doc_chrom = str(hg38.get("chrom", ""))
                        if not doc_chrom and vcf:
                            doc_chrom = str(vcf.get("chrom", ""))
                            
                        doc_chrom = f"chr{doc_chrom}" if not doc_chrom.startswith("chr") else doc_chrom
                        
                        # Match back to our missing variant
                        for v in batch:
                            if v["chromosome"] == doc_chrom and str(v["position"]) == item.get("query"):
                                results[v["hgvs_id"]] = item
                                found_count += 1
                                break
                                
                    print(f"[MYVARIANT API] Pass 2: Recovered {found_count} variants via position search.")
            except Exception as e:
                print(f"[MYVARIANT API] Pass 2 lookup failed: {e}")
                
    return results

def get_priority(sig: str) -> int:
    sig = str(sig).lower()
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
        return 2 # Other known labels
    return 0

def parse_vcf_content(vcf_text: str, sample_id: str, patient_id: str, settings=None, vastdb_client=None) -> Tuple[List[Dict[str, Any]], Dict[str, int]]:
    base_variants = []
    
    # Pass 1: Parse the VCF
    for line in vcf_text.strip().splitlines():
        if line.startswith("#"):
            continue

        fields = line.split("\t")
        if len(fields) < 8:
            continue

        chrom = fields[0]
        position = int(fields[1])
        ref_allele = fields[3]
        alt_allele = fields[4]
        quality = float(fields[5]) if fields[5] != "." else 0.0
        filter_status = fields[6]
        info_field = fields[7] if len(fields) > 7 else ""

        info = _parse_info(info_field)
        allele_frequency = info.get("AF", 0.0)
        read_depth = info.get("DP", 0)

        gene = _resolve_gene(chrom, position)
        variant_type = _classify_variant(ref_allele, alt_allele)

        base_variants.append({
            "sample_id": sample_id,
            "patient_id": patient_id,
            "chromosome": chrom,
            "position": position,
            "ref_allele": ref_allele,
            "alt_allele": alt_allele,
            "gene": gene,
            "variant_type": variant_type,
            "quality": quality,
            "filter_status": filter_status,
            "allele_frequency": allele_frequency,
            "read_depth": read_depth,
            "hgvs_id": f"{chrom}:g.{position}{ref_allele}>{alt_allele}",
            "cache_key": f"{chrom}:{position}:{ref_allele}>{alt_allele}"
        })

    # Pass 2: Check VastDB Cache
    cached_data = {}
    if vastdb_client:
        cached_data = vastdb_client.get_cached_variants(base_variants)

    # Pass 3: Identify uncached variants and batch query MyVariant.info
    uncached_variants = []
    for bv in base_variants:
        if bv["cache_key"] not in cached_data:
            uncached_variants.append(bv)
    
    myvariant_data = myvariant_lookup_batch(uncached_variants)

    # Pass 4: Assemble final variants
    final_variants = []
    for bv in base_variants:
        cache_key = bv.pop("cache_key")
        hgvs_id = bv.pop("hgvs_id")
        
        # 1. First, determine the best gene name from cache or myvariant
        if cache_key in cached_data and cached_data[cache_key].get("gene") and cached_data[cache_key].get("gene") != "UNKNOWN":
            bv["gene"] = cached_data[cache_key]["gene"]
        elif hgvs_id in myvariant_data:
            item = myvariant_data[hgvs_id]
            found_gene = None
            
            # Try to get gene from clinvar
            if "clinvar" in item and "gene" in item["clinvar"]:
                gene_data = item["clinvar"]["gene"]
                if isinstance(gene_data, list) and len(gene_data) > 0:
                    found_gene = gene_data[0].get("symbol")
                elif isinstance(gene_data, dict):
                    found_gene = gene_data.get("symbol")
            
            # Try to get gene from snpeff
            if not found_gene and "snpeff" in item and "ann" in item["snpeff"]:
                ann = item["snpeff"]["ann"]
                if isinstance(ann, list) and len(ann) > 0:
                    found_gene = ann[0].get("genename")
                elif isinstance(ann, dict):
                    found_gene = ann.get("genename")
                    
            if found_gene:
                bv["gene"] = found_gene
        
        variant_location = (
            f"{bv['variant_type']} at {bv['chromosome']}:{bv['position']} "
            f"({bv['ref_allele']}>{bv['alt_allele']}) in {bv['gene']}."
        )

        if cache_key in cached_data:
            cached_sig = cached_data[cache_key].get("clinical_significance", "uncertain significance")
            cached_desc = cached_data[cache_key].get("variant_description", "")

            bv["clinical_significance"] = cached_sig

            if cached_desc.startswith("Patient "):
                clinical_part = cached_desc
                colon_idx = cached_desc.find(": ")
                if colon_idx != -1:
                    clinical_part = cached_desc[colon_idx + 2:]
                af_idx = clinical_part.rfind(" AF=")
                if af_idx != -1:
                    clinical_part = clinical_part[:af_idx].strip()
                bv["variant_description"] = clinical_part or variant_location
            else:
                bv["variant_description"] = cached_desc or variant_location

            bv["vectors"] = cached_data[cache_key].get("vectors")
            bv["cache_hits_count"] = cached_data[cache_key].get("cache_hits_count", 0) + 1

        else:
            bv["cache_hits_count"] = 0
            clinvar = myvariant_data.get(hgvs_id, {}).get("clinvar")
            if clinvar and "rcv" in clinvar:
                rcvs = clinvar["rcv"] if isinstance(clinvar["rcv"], list) else [clinvar["rcv"]]
                sigs = [r.get("clinical_significance", "").lower() for r in rcvs]
                if any("pathogenic" in s and "likely" not in s for s in sigs):
                    sig = "Pathogenic"
                elif any("likely pathogenic" in s for s in sigs):
                    sig = "Likely pathogenic"
                elif any("uncertain" in s for s in sigs):
                    sig = "Uncertain significance"
                else:
                    sig = rcvs[0].get("clinical_significance", "unknown")

                conditions = rcvs[0].get("conditions", [])
                if isinstance(conditions, list) and len(conditions) > 0:
                    disease = conditions[0].get("name", "Unknown disease")
                elif isinstance(conditions, dict):
                    disease = conditions.get("name", "Unknown disease")
                else:
                    disease = "Unknown disease"

                clinvar_id = rcvs[0].get("accession", "Unknown")

                bv["clinical_significance"] = sig
                clinical_core = f"{sig} - {disease} (ClinVar: {clinvar_id})."

                if get_priority(sig) > 6 and settings and settings.nvidia_api_key and getattr(settings, "llm_model", None):
                    if settings.use_api_catalog:
                        llm_base_url = "https://integrate.api.nvidia.com/v1"
                    else:
                        llm_base_url = f"{settings.llmhttpscheme}://{settings.llmhost}:{settings.llmport}/v1"
                    rich_summary = _generate_llm_summary(
                        settings.nvidia_api_key,
                        settings.llm_model,
                        llm_base_url,
                        bv["gene"], bv["chromosome"], bv["position"], bv["ref_allele"], bv["alt_allele"], sig, disease
                    )
                    if rich_summary:
                        bv["variant_description"] = f"{variant_location} {clinical_core} Clinical Context: {rich_summary}"
                    else:
                        bv["variant_description"] = f"{variant_location} {clinical_core}"
                else:
                    bv["variant_description"] = f"{variant_location} {clinical_core}"
            else:
                bv["clinical_significance"] = "uncertain significance"
                bv["variant_description"] = f"{variant_location} Uncertain significance."

        final_variants.append(bv)

    stats = {
        "cache_hits": len(cached_data),
        "api_calls": len(uncached_variants)
    }

    return final_variants, stats


def _resolve_gene(chrom: str, position: int) -> str:
    for region_chrom, start, end, gene in GENE_REGIONS:
        if chrom == region_chrom and start <= position <= end:
            return gene
    return "intergenic"


def _classify_variant(ref: str, alt: str) -> str:
    if len(ref) == 1 and len(alt) == 1:
        return "SNP"
    if len(ref) > len(alt):
        return "DELETION"
    if len(ref) < len(alt):
        return "INSERTION"
    return "MNP"


def _parse_info(info_str: str) -> Dict[str, Any]:
    result: Dict[str, Any] = {}
    if not info_str or info_str == ".":
        return result
    for pair in info_str.split(";"):
        if "=" not in pair:
            continue
        key, value = pair.split("=", 1)
        if key == "DP":
            result["DP"] = int(value)
        elif key == "AF":
            result["AF"] = float(value)
        else:
            result[key] = value
    return result


def _generate_llm_summary(api_key: str, model: str, llm_base_url: str, gene: str, chrom: str, position: int, ref: str, alt: str, significance: str, disease: str) -> str:
    prompt = (
        f"Generate a rich 3-sentence clinical summary for the following genomic variant, "
        f"detailing associated drugs and typical prognoses based on known medical literature. "
        f"Variant: {gene} {chrom}:{position} ({ref}>{alt}). "
        f"Clinical Significance: {significance}. Disease: {disease}."
    )
    
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }
    
    data = {
        "model": model,
        "messages": [
            {"role": "system", "content": "You are a clinical genomics assistant."},
            {"role": "user", "content": prompt}
        ],
        "max_tokens": 150,
        "temperature": 0.2
    }
    
    try:
        response = requests.post(f"{llm_base_url}/chat/completions", headers=headers, json=data, timeout=10)
        response.raise_for_status()
        return response.json()["choices"][0]["message"]["content"].strip()
    except Exception as e:
        print(f"Error calling LLM for variant {gene} {chrom}:{position}: {e}")
        return ""
