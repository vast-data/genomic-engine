import logging
import posixpath
from typing import Dict, List, Optional
from urllib.parse import urlparse

import boto3
from botocore.exceptions import ClientError

from src.config import settings


class S3Service:
    def __init__(self):
        cfg = settings.s3
        creds = settings.vast
        self.client = boto3.client(
            "s3",
            endpoint_url=cfg.endpoint,
            aws_access_key_id=creds.access_key,
            aws_secret_access_key=creds.secret_key,
            verify=False,
        )
        self.fastq_bucket = cfg.fastq_bucket
        self.vcf_bucket = cfg.vcf_bucket

    @staticmethod
    def parse_s3_uri(uri: str) -> tuple[str, str]:
        parsed = urlparse(uri)
        bucket = parsed.netloc
        key = parsed.path.lstrip("/")
        return bucket, key

    @staticmethod
    def build_controlled_key(patient_id: str, sample_id: str, filename: str) -> str:
        return f"{patient_id}/{sample_id}/{filename}"

    def head_object(self, bucket: str, key: str) -> bool:
        try:
            self.client.head_object(Bucket=bucket, Key=key)
            return True
        except ClientError:
            return False

    def copy_object(
        self,
        src_bucket: str,
        src_key: str,
        dst_bucket: str,
        dst_key: str,
    ) -> str:
        try:
            self.client.copy_object(
                CopySource={"Bucket": src_bucket, "Key": src_key},
                Bucket=dst_bucket,
                Key=dst_key,
            )
            return f"s3://{dst_bucket}/{dst_key}"
        except Exception as e:
            logging.error(f"S3 copy failed: {e}")
            raise

    def put_object(self, bucket: str, key: str, body: str) -> str:
        try:
            self.client.put_object(
                Bucket=bucket,
                Key=key,
                Body=body.encode("utf-8")
            )
            return f"s3://{bucket}/{key}"
        except Exception as e:
            logging.error(f"S3 put failed: {e}")
            raise

    def get_object(self, bucket: str, key: str) -> str:
        response = self.client.get_object(Bucket=bucket, Key=key)
        return response["Body"].read().decode("utf-8")

    def get_object_by_uri(self, uri: str) -> str:
        bucket, key = self.parse_s3_uri(uri)
        return self.get_object(bucket, key)

    def copy_fastq_to_controlled_path(
        self,
        source_uri: str,
        patient_id: str,
        sample_id: str,
    ) -> str:
        src_bucket, src_key = self.parse_s3_uri(source_uri)
        filename = posixpath.basename(src_key)
        dst_key = self.build_controlled_key(patient_id, sample_id, filename)

        return self.copy_object(src_bucket, src_key, self.fastq_bucket, dst_key)

    def list_keys(self, bucket: str, prefix: str = "") -> List[str]:
        keys: List[str] = []
        continuation_token: Optional[str] = None
        while True:
            kwargs = {"Bucket": bucket, "Prefix": prefix}
            if continuation_token:
                kwargs["ContinuationToken"] = continuation_token
            try:
                resp = self.client.list_objects_v2(**kwargs)
            except ClientError as e:
                logging.warning(f"S3 list_objects_v2 failed for {bucket}: {e}")
                return keys
            for obj in resp.get("Contents", []) or []:
                keys.append(obj["Key"])
            if not resp.get("IsTruncated"):
                break
            continuation_token = resp.get("NextContinuationToken")
        return keys

    def wipe_bucket(self, bucket: str) -> Dict[str, int]:
        keys = self.list_keys(bucket, "")
        deleted = 0
        failed = 0
        for batch_start in range(0, len(keys), 1000):
            batch = keys[batch_start:batch_start + 1000]
            try:
                resp = self.client.delete_objects(
                    Bucket=bucket,
                    Delete={"Objects": [{"Key": k} for k in batch], "Quiet": True},
                )
                errs = resp.get("Errors") or []
                deleted += len(batch) - len(errs)
                failed += len(errs)
            except Exception as exc:
                logging.warning(f"S3 delete_objects failed for {bucket}: {exc}")
                failed += len(batch)
        return {"matched": len(keys), "deleted": deleted, "failed": failed}
