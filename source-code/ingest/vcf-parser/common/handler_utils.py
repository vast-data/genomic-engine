from typing import Tuple


def should_process_event(key: str, event_name: str) -> Tuple[bool, str]:
    if "Delete" in event_name:
        return False, "Delete event"

    if not key.lower().endswith(".vcf"):
        return False, f"Not a VCF file: {key}"

    return True, ""
