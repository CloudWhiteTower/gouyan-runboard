"""Dependency-free input validation shared by SDK and service."""

import json
import math
import re

SENSITIVE = re.compile(
    r"(^|[_.-])(password|passwd|secret|token|api_key|credential|private_key)([_.-]|$)",
    re.I,
)


def redact_text(text):
    """Redact credential assignments and recognizable tokens before persistence."""
    text = re.sub(
        r"-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----",
        "[REDACTED PRIVATE KEY]",
        str(text),
    )
    text = re.sub(r"(?i)\bBearer\s+[A-Za-z0-9._~+/=-]+", "Bearer [REDACTED]", text)
    text = re.sub(
        r"(?i)(\b(?:password|passwd|secret|token|api[_-]?key|authorization|credential)\b[\"']?\s*[:=]\s*)(?:[\"'][^\"'\r\n]*[\"']|[^\s,;}]+)",
        r"\1[REDACTED]",
        text,
    )
    text = re.sub(
        r"\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b",
        "[REDACTED]",
        text,
    )
    return text


def clean_config(config):
    for key, value in config.items():
        if not isinstance(key, str):
            raise ValueError("参数名称必须是字符串。")
        if SENSITIVE.search(key):
            raise ValueError("配置中包含凭据字段，请移除该字段后重试。")
        if isinstance(value, dict):
            clean_config(value)
        elif isinstance(value, list):
            for item in value:
                if isinstance(item, dict):
                    clean_config(item)
        elif isinstance(value, float) and not math.isfinite(value):
            raise ValueError("超参数必须是有限数值。")
    json.dumps(config, ensure_ascii=False, allow_nan=False)
    return config
