"""
services/ai_client.py
Central factory for OpenAI / Azure OpenAI clients.

Priority:
  1. If AZURE_OPENAI_ENDPOINT + AZURE_OPENAI_API_KEY are set → AzureOpenAI
  2. Otherwise → OpenAI (OPENAI_API_KEY)

Usage:
    from api.services.ai_client import get_client, chat_model, embedding_model

    client = get_client()
    resp = client.chat.completions.create(model=chat_model(), messages=[...])
"""
from __future__ import annotations
from functools import lru_cache


@lru_cache(maxsize=1)
def _use_azure() -> bool:
    from api.config import settings
    return bool(
        settings.AZURE_OPENAI_ENDPOINT.strip()
        and settings.AZURE_OPENAI_API_KEY.strip()
    )


def get_client():
    """Return a configured OpenAI-compatible client (Azure or standard)."""
    from api.config import settings
    if _use_azure():
        from openai import AzureOpenAI
        return AzureOpenAI(
            api_key        = settings.AZURE_OPENAI_API_KEY,
            azure_endpoint = settings.AZURE_OPENAI_ENDPOINT,
            api_version    = settings.AZURE_OPENAI_API_VERSION,
        )
    from openai import OpenAI
    return OpenAI(api_key=settings.OPENAI_API_KEY)


def get_client_for_key(api_key: str):
    """
    Return a client for a caller-supplied api_key.
    If Azure is configured, ignores api_key and uses Azure credentials.
    If api_key is blank, falls back to settings.OPENAI_API_KEY.
    """
    from api.config import settings
    if _use_azure():
        return get_client()
    key = api_key or settings.OPENAI_API_KEY
    from openai import OpenAI
    return OpenAI(api_key=key)


def chat_model(requested: str | None = None) -> str:
    """
    Return the model name to use for chat completions.
    Azure: returns the deployment name from settings (ignores requested).
    Standard: returns requested if given, else 'gpt-4o-mini'.
    """
    from api.config import settings
    if _use_azure():
        return settings.AZURE_OPENAI_DEPLOYMENT
    return requested or "gpt-4o-mini"


def embedding_model(requested: str | None = None) -> str:
    """Return the model/deployment name for embeddings."""
    from api.config import settings
    if _use_azure():
        return settings.AZURE_OPENAI_EMB_DEPLOYMENT
    return requested or "text-embedding-3-small"
