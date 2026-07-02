import logging
import re
import time
from typing import List, Dict, Any, Optional

import requests

from src.config import settings
from src.services.retry import DEFAULT_MAX_RETRIES, call_with_retry

NVIDIA_API_CATALOG_URL = "https://integrate.api.nvidia.com/v1"

logger = logging.getLogger(__name__)

_THINK_BLOCK_RE = re.compile(r"<think>.*?</think>\s*", re.DOTALL | re.IGNORECASE)
_OPEN_THINK_RE = re.compile(r"<think>", re.IGNORECASE)
_JSON_FENCE_RE = re.compile(r"^```(?:json)?\s*|\s*```$", re.MULTILINE)

NO_THINK_DIRECTIVE = "/no_think"


def _short_error(e: Exception) -> str:
    msg = str(e)
    if "Read timed out" in msg or "ReadTimeoutError" in msg:
        return "LLM request timed out"
    if "ConnectionError" in msg or "Connection refused" in msg:
        return "LLM endpoint unreachable"
    return msg.split("\n")[0][:200]


def _strip_reasoning(text: str) -> str:
    if not text:
        return ""
    text = _THINK_BLOCK_RE.sub("", text)
    lowered = text.lower()
    if "</think>" in lowered:
        text = text[lowered.rfind("</think>") + len("</think>"):]
    open_match = _OPEN_THINK_RE.search(text)
    if open_match:
        text = text[:open_match.start()]
    return text.strip()


def _extract_json_object(text: str) -> str:
    text = _strip_reasoning(text)
    text = _JSON_FENCE_RE.sub("", text).strip()
    start = text.find("{")
    end = text.rfind("}")
    if start >= 0 and end > start:
        return text[start:end + 1]
    return text


class LLMService:
    DEFAULT_TIMEOUT = 55
    SYNTHESIZE_TIMEOUT = 180

    def __init__(self):
        cfg = settings.llm
        nv = settings.nvidia
        self.model = cfg.model
        self.system_prompt = cfg.system_prompt
        self.disable_reasoning = cfg.disable_reasoning
        self.use_api_catalog = nv.use_api_catalog
        self.api_key = nv.api_key

        if self.use_api_catalog:
            self.base_url = NVIDIA_API_CATALOG_URL
        else:
            self.base_url = f"http://{cfg.host}:{cfg.port}/v1"

    def _system_content(self) -> str:
        base = self.system_prompt or ""
        if self.disable_reasoning:
            return f"{NO_THINK_DIRECTIVE}\n{base}".strip()
        return base

    def _temperature(self, reasoning_temp: float) -> float:
        return 0.0 if self.disable_reasoning else reasoning_temp

    def _post_chat(
        self,
        label: str,
        payload: Dict[str, Any],
        timeout: Optional[int] = None,
        max_retries: int = DEFAULT_MAX_RETRIES,
    ) -> str:
        timeout = timeout or self.DEFAULT_TIMEOUT
        headers = {"Content-Type": "application/json"}
        if self.use_api_catalog:
            headers["Authorization"] = f"Bearer {self.api_key}"

        url = f"{self.base_url}/chat/completions"
        t0 = time.perf_counter()

        try:
            response = call_with_retry(
                lambda: requests.post(url, json=payload, headers=headers, timeout=timeout),
                operation=f"LLM:{label}",
                max_retries=max_retries,
            )
            response.raise_for_status()
        except requests.HTTPError as e:
            elapsed_ms = int((time.perf_counter() - t0) * 1000)
            logger.error(
                "[LLM:%s] http err elapsed_ms=%d err=%s",
                label, elapsed_ms, _short_error(e),
            )
            raise
        except Exception as e:
            elapsed_ms = int((time.perf_counter() - t0) * 1000)
            logger.error(
                "[LLM:%s] exhausted retries elapsed_ms=%d err=%s",
                label, elapsed_ms, _short_error(e),
            )
            raise

        elapsed_ms = int((time.perf_counter() - t0) * 1000)
        logger.info(
            "[LLM:%s] ok http=%d elapsed_ms=%d model=%s",
            label, response.status_code, elapsed_ms, self.model,
        )
        content = response.json()["choices"][0]["message"]["content"]
        return _strip_reasoning(content)

    def explain_variant(self, variant: Dict[str, Any]) -> str:
        prompt = (
            "You are a clinical genomics assistant. Explain the following genetic variant finding in clear, simple language "
            "so that a doctor or patient can easily understand it. Structure your response exactly like this:\n\n"
            "Gene (<Gene>): <Explanation>\n\n"
            "Location (<Location>): <Explanation>\n\n"
            "Change (<Change>): <Explanation>\n\n"
            "Type (<Type>): <Explanation>\n\n"
            "Quality (<Quality>): <Explanation>\n\n"
            "Significance (<Significance>): <Explanation>\n\n"
            f"Variant Details:\n"
            f"Gene: {variant.get('gene', 'Unknown')}\n"
            f"Location: {variant.get('chromosome', 'Unknown')}:{variant.get('position', 'Unknown')}\n"
            f"Change: {variant.get('ref_allele', '')}>{variant.get('alt_allele', '')}\n"
            f"Type: {variant.get('variant_type', 'Unknown')}\n"
            f"Quality: {variant.get('quality', 0)}\n"
            f"Significance: {variant.get('clinical_significance', 'Unknown')}\n"
            f"Description: {variant.get('variant_description', '')}\n"
        )

        messages = [
            {"role": "system", "content": self._system_content()},
            {"role": "user", "content": prompt},
        ]
        return self._post_chat(
            "explain",
            {"model": self.model, "messages": messages, "max_tokens": 1024, "temperature": self._temperature(0.3)},
        )

    def generate_insights(self, variant: Dict[str, Any], patient_data: Optional[Dict[str, Any]] = None) -> str:
        patient_context = ""
        if patient_data:
            patient_context = (
                f"Patient Context: The patient has the following demographics for reference:\n"
                f"Age: {patient_data.get('age', 'Unknown')}\n"
                f"Sex: {patient_data.get('sex', 'Unknown')}\n"
                f"Ethnicity: {patient_data.get('ethnicity', 'Unknown')}\n"
                f"Ensure the clinical summary mentions the relevance of this variant for this specific patient demographic if applicable.\n"
            )

        prompt = (
            "You are a clinical genomics assistant. Provide a statistical overview, demographics comparison, "
            "and drug recommendations based on public research for this specific genetic variant.\n"
            f"{patient_context}\n"
            "Respond with ONLY a JSON object. No prose, no <think> tags, no markdown fences. "
            "The JSON must match this exact structure:\n"
            "{\n"
            "  \"population_frequency_pct\": 0.5,\n"
            "  \"likelihood_of_disease_evolvement_pct\": 45.0,\n"
            "  \"mortality_risk_pct\": 12.5,\n"
            "  \"ethnicities\": [\n"
            "    {\"name\": \"European\", \"frequency_pct\": 0.6}\n"
            "  ],\n"
            "  \"age_groups\": [\n"
            "    {\"group\": \"Adult (18-64)\", \"frequency_pct\": 0.7}\n"
            "  ],\n"
            "  \"drug_recommendations\": [\n"
            "    {\"drug\": \"<drug name>\", \"indication\": \"<the actual disease from the variant>\", \"evidence_level\": \"High|Moderate|Low\"}\n"
            "  ],\n"
            "  \"clinical_summary\": \"A short paragraph summarizing the insights, evolution likelihood, and recommendations, bringing true data from online/medical literature.\"\n"
            "}\n\n"
            "IMPORTANT: Base ALL disease associations, drug recommendations, and clinical summaries strictly on the variant description and clinical context provided below. "
            "Do NOT infer or guess a different disease. The drug indications must match the disease described in the variant details.\n"
            "If exact numbers are unknown, provide your best educated estimate based on current medical literature for this gene/variant, but strictly adhere to the JSON format. Do NOT wrap the JSON in Markdown backticks.\n\n"
            f"Variant Details:\n"
            f"Gene: {variant.get('gene', 'Unknown')}\n"
            f"Location: {variant.get('chromosome', 'Unknown')}:{variant.get('position', 'Unknown')}\n"
            f"Change: {variant.get('ref_allele', '')}>{variant.get('alt_allele', '')}\n"
            f"Significance: {variant.get('clinical_significance', 'Unknown')}\n"
            f"Description: {variant.get('variant_description', 'Not available')}\n"
        )

        messages = [
            {"role": "system", "content": self._system_content()},
            {"role": "user", "content": prompt},
        ]
        raw = self._post_chat(
            "insights",
            {
                "model": self.model,
                "messages": messages,
                "max_tokens": 1024,
                "temperature": self._temperature(0.2),
            },
        )
        return _extract_json_object(raw)

    def analyze_patient(self, patient: Dict[str, Any], variants: List[Dict[str, Any]]) -> str:
        if not variants:
            return "No variants available to analyze for this patient."

        patient_info = (
            f"Patient ID: {patient.get('patient_id', 'Unknown')}\n"
            f"Age: {patient.get('age', 'Unknown')}\n"
            f"Sex: {patient.get('sex', 'Unknown')}\n"
            f"Ethnicity: {patient.get('ethnicity', 'Unknown')}\n"
            f"Clinical History: {patient.get('clinical_history', 'Unknown')}\n"
        )

        variant_details = []
        for v in variants[:20]:
            variant_details.append(
                f"- Gene: {v.get('gene', 'Unknown')} | "
                f"Location: {v.get('chromosome')}:{v.get('position')} | "
                f"Change: {v.get('ref_allele')}>{v.get('alt_allele')} | "
                f"Significance: {v.get('clinical_significance', 'Unknown')} | "
                f"Desc: {v.get('variant_description', '')}"
            )
        variant_text = "\n".join(variant_details)

        messages = [
            {"role": "system", "content": self._system_content()},
            {
                "role": "user",
                "content": (
                    f"Please provide a comprehensive clinical analysis and synthesis for the following patient based on their demographic profile and genetic variants.\n\n"
                    f"Patient Profile:\n{patient_info}\n\n"
                    f"Genetic Variants Found:\n{variant_text}\n\n"
                    "Provide a detailed clinical report that highlights the most important findings, their potential impact on the patient's health or treatment, and any recommended next steps or considerations."
                ),
            },
        ]

        try:
            return self._post_chat(
                "patient_analysis",
                {"model": self.model, "messages": messages, "max_tokens": 2048, "temperature": self._temperature(0.3)},
            )
        except Exception as e:
            logger.error("[LLM:patient_analysis] giving up err=%s", _short_error(e))
            return "Failed to generate patient analysis."

    def synthesize(self, query: str, variant_contexts: List[Dict[str, Any]], patient_id: Optional[str] = None, quality: Optional[str] = None) -> str:
        if not variant_contexts:
            return "No relevant variants found for your query."

        # Pass more context variants but be mindful of the model's token context window.
        context_text = "\n".join(
            f"- Gene: {v.get('gene', 'Unknown')} | "
            f"Location: {v.get('chromosome')}:{v.get('position')} | "
            f"Change: {v.get('ref_allele')}>{v.get('alt_allele')} | "
            f"Significance: {v.get('clinical_significance', 'Unknown')} | "
            f"Desc: {v.get('variant_description', '')} "
            f"(similarity: {v.get('similarity_score', 0):.3f}, quality: {v.get('quality', 0)})"
            for v in variant_contexts[:100]
        )

        filter_text = ""
        if patient_id or quality:
            filter_text = "The user has applied the following filters:\n"
            if patient_id:
                filter_text += f"- Patient ID: {patient_id} (Highlight urgent cases or variants to take care of for this specific patient).\n"
            if quality:
                filter_text += f"- Minimum Quality: {quality}\n"

        messages = [
            {"role": "system", "content": self._system_content()},
            {
                "role": "user",
                "content": (
                    f"You are answering a specific clinical question from the user: '{query}'\n\n"
                    f"{filter_text}\n"
                    f"Retrieved variant data:\n{context_text}\n\n"
                    "Provide a clinical summary answering the user's specific question based strictly on these variants. Craft the data properly to maximize value for the request. If the user asks for specific information (like drug recommendations or pathogenic variants), ensure you explicitly provide that information. If there are urgent cases/variants to take care of or notice based on the patient filter, bring them up."
                ),
            },
        ]

        try:
            return self._post_chat(
                "synthesize",
                {"model": self.model, "messages": messages, "max_tokens": 2048, "temperature": self._temperature(0.3)},
                timeout=self.SYNTHESIZE_TIMEOUT,
                max_retries=1,
            )
        except Exception as e:
            return f"LLM synthesis unavailable: {_short_error(e)}"
