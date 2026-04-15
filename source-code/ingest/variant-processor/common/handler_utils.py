from typing import Dict, Any, List


def parse_variant_event(event_data: Dict[str, Any]) -> Dict[str, Any]:
    variants = event_data.get("variants", [])
    if not variants:
        raise ValueError("No variants in event data")

    return {
        "source": event_data.get("vcf_source", ""),
        "sample_id": event_data.get("sample_id", ""),
        "patient_id": event_data.get("patient_id", ""),
        "variant_count": event_data.get("variant_count", len(variants)),
        "variants": variants,
        "stats": event_data.get("stats", {"cache_hits": 0, "api_calls": 0}),
    }


def validate_variants(variants: List[Dict[str, Any]]) -> bool:
    if not variants:
        return False
    required_fields = {"variant_description", "chromosome", "position"}
    return all(required_fields.issubset(v.keys()) for v in variants)
