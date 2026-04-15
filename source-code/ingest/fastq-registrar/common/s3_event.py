from typing import Dict, Any
from urllib.parse import unquote


def parse_s3_event(event_data: Dict[str, Any]) -> Dict[str, str]:
    if "Records" in event_data:
        record = event_data["Records"][0]
        s3_info = record.get("s3", {})
        bucket = s3_info.get("bucket", {}).get("name", "")
        key = s3_info.get("object", {}).get("key", "")
        event_name = record.get("eventName", "unknown")
    elif "bucket" in event_data and "key" in event_data:
        bucket = event_data["bucket"]
        key = event_data["key"]
        event_name = event_data.get("eventName", "unknown")
    else:
        raise ValueError(f"Unsupported event format: {event_data}")

    return {
        "bucket": bucket,
        "key": unquote(key),
        "event_name": event_name,
    }
