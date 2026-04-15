from typing import Tuple


def should_process_event(key: str, event_name: str) -> Tuple[bool, str]:
    if "Delete" in event_name:
        return False, "Delete event"

    fastq_extensions = [".fastq", ".fastq.gz", ".fq", ".fq.gz"]
    key_lower = key.lower()

    if not any(key_lower.endswith(ext) for ext in fastq_extensions):
        return False, f"Not a FASTQ file: {key}"

    return True, ""
