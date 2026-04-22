# ═══════════════════════════════════════════════════════════
# playwright_runner.py — Headless browser validation engine
#
# Uses Playwright to navigate to a target app, login if required,
# extract UI field values using template-defined CSS selectors,
# and take a screenshot.  Supports session reuse so repeated runs
# against the same connection skip the login step.
#
# One-time setup (run once after pip install playwright):
#   playwright install chromium
# ═══════════════════════════════════════════════════════════
from __future__ import annotations

import asyncio
import json
import logging
import os
from datetime import datetime
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# Screenshots and session state are stored under screenshots/ at project root
_SCREENSHOT_DIR = Path(__file__).resolve().parent.parent.parent / "screenshots"
_SESSION_DIR    = _SCREENSHOT_DIR / "sessions"


def _ensure_dirs() -> None:
    _SCREENSHOT_DIR.mkdir(parents=True, exist_ok=True)
    _SESSION_DIR.mkdir(parents=True, exist_ok=True)


def _session_path(template_id: int) -> Path:
    return _SESSION_DIR / f"template_{template_id}.json"


async def _run_async(
    template: dict[str, Any],
    entity: str,
    entity_id: str,
    xml_path: str | None,
) -> dict[str, Any]:
    """Internal async implementation — called via asyncio.run()."""
    _ensure_dirs()

    try:
        from playwright.async_api import async_playwright, TimeoutError as PWTimeout
    except ImportError:
        raise RuntimeError(
            "playwright is not installed. Run: pip install playwright && playwright install chromium"
        )

    headless: bool = os.getenv("PLAYWRIGHT_HEADLESS", "true").lower() != "false"
    template_id: int = template.get("id", 0)

    entity_paths: dict = template.get("entity_paths", {})
    if entity not in entity_paths:
        raise ValueError(f"Entity '{entity}' not found in template entity_paths: {list(entity_paths)}")

    target_url: str = template["base_url"].rstrip("/") + entity_paths[entity].replace("{id}", str(entity_id))
    selectors: dict = template.get("selectors", {})
    login_config: dict | None = template.get("login_config")

    session_file = _session_path(template_id)
    storage_state = str(session_file) if session_file.exists() else None

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=headless)
        context_kwargs: dict[str, Any] = {}
        if storage_state:
            try:
                context_kwargs["storage_state"] = storage_state
                logger.info("Reusing saved session for template %s", template_id)
            except Exception:
                storage_state = None

        context = await browser.new_context(**context_kwargs)
        page = await context.new_page()

        # ── Login step (only when no saved session) ───────────
        if login_config and not storage_state:
            login_url: str | None = login_config.get("login_url")
            if login_url:
                await page.goto(login_url, wait_until="networkidle")
            else:
                await page.goto(target_url, wait_until="networkidle")

            uname_sel = login_config.get("username_selector")
            pword_sel = login_config.get("password_selector")
            submit_sel = login_config.get("submit_selector")
            username  = login_config.get("username", "")
            password  = login_config.get("password", "")

            if uname_sel and username:
                await page.fill(uname_sel, username)
            if pword_sel and password:
                await page.fill(pword_sel, password)
            if submit_sel:
                await page.click(submit_sel)
                await page.wait_for_load_state("networkidle")

            await context.storage_state(path=str(session_file))
            logger.info("Saved session state for template %s", template_id)

        # ── Navigate to entity page ────────────────────────────
        await page.goto(target_url, wait_until="networkidle")

        # Wait for at least one selector to confirm page loaded
        if selectors:
            first_sel = next(iter(selectors.values()))
            try:
                await page.wait_for_selector(first_sel, timeout=15_000)
            except PWTimeout:
                logger.warning("Timed out waiting for selector %r", first_sel)

        # ── Extract UI field values ────────────────────────────
        ui_values: dict[str, str | None] = {}
        for field, selector in selectors.items():
            try:
                el = await page.query_selector(selector)
                if el:
                    # Prefer innerText for visible content; fallback to input value
                    text = await el.inner_text()
                    if not text.strip():
                        text = await el.input_value() if await el.get_attribute("type") else text
                    ui_values[field] = text.strip()
                else:
                    ui_values[field] = None
            except Exception as exc:
                logger.warning("Failed to extract field %r (%r): %s", field, selector, exc)
                ui_values[field] = None

        # ── Screenshot ─────────────────────────────────────────
        ts = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
        screenshot_name = f"{entity}_{entity_id}_{ts}.png"
        screenshot_path = _SCREENSHOT_DIR / screenshot_name
        await page.screenshot(path=str(screenshot_path), full_page=True)

        await context.close()
        await browser.close()

    return {
        "url":             target_url,
        "ui_values":       ui_values,
        "screenshot_path": f"screenshots/{screenshot_name}",
    }


def run_validation(
    template: dict[str, Any],
    entity: str,
    entity_id: str,
    xml_path: str | None,
) -> dict[str, Any]:
    """
    Synchronous entry point called from FastAPI route handlers.
    Runs the async Playwright engine in a new event loop.

    Args:
        template:   dict built from UiValidationTemplate ORM row
        entity:     entity type key e.g. "policy"
        entity_id:  concrete entity identifier e.g. "12345"
        xml_path:   optional local path to XML file for field comparison

    Returns:
        {url, ui_values, screenshot_path}
    """
    return asyncio.run(_run_async(template, entity, entity_id, xml_path))


def clear_session(template_id: int) -> bool:
    """Delete saved browser session for a template (forces re-login next run)."""
    path = _session_path(template_id)
    if path.exists():
        path.unlink()
        return True
    return False
