"""Xiaohongshu (小红书) scraper using Playwright headless browser.

Strategy: Uses cookie-authenticated Playwright browser. For individual notes,
we load the page with cookies and intercept the client-side API call that
fetches note detail data (XHS blocks unauthenticated headless browsers).
For profile scanning, we intercept paginated API responses while scrolling.

Note: Playwright cannot run inside uvicorn's ProactorEventLoop on Windows,
so we run it in a separate thread with its own event loop.
"""
from __future__ import annotations

import asyncio
import concurrent.futures
import json
import logging
import re
from datetime import datetime
from typing import Optional

from .base import AccountScanResult, BaseScraper, MediaItem, NotePreview, ScraperResult

logger = logging.getLogger("motif.scraper.xhs")

# Patterns to match Xiaohongshu URLs
_PATTERNS = [
    re.compile(r'https?://xhslink\.com/[A-Za-z0-9/]+'),
    re.compile(r'https?://www\.xiaohongshu\.com/explore/[a-f0-9]+'),
    re.compile(r'https?://www\.xiaohongshu\.com/discovery/item/[a-f0-9]+'),
]

_INITIAL_STATE_RE = re.compile(
    r'window\.__INITIAL_STATE__\s*=\s*(\{.+?\})\s*</script>', re.DOTALL
)

# Thread pool for running Playwright (needs its own event loop on Windows)
_executor = concurrent.futures.ThreadPoolExecutor(max_workers=2)


def _get_cookie() -> str:
    from config import get_settings
    cookie = get_settings().platform_cookies.get("xiaohongshu", "")
    if not cookie:
        raise RuntimeError(
            "请先在「设置 → 服务」中配置小红书 Cookie（从浏览器复制登录后的 Cookie）"
        )
    return cookie


def _ensure_https(url: str) -> str:
    """Ensure URL has https: protocol (XHS sometimes uses protocol-relative URLs)."""
    if url.startswith("//"):
        return "https:" + url
    return url


def _parse_cookie_to_playwright(cookie_str: str) -> list[dict]:
    """Parse a raw cookie string into Playwright's cookie format."""
    cookies = []
    for part in cookie_str.split(";"):
        part = part.strip()
        if "=" in part:
            name, _, value = part.partition("=")
            cookies.append({
                "name": name.strip(),
                "value": value.strip(),
                "domain": ".xiaohongshu.com",
                "path": "/",
            })
    return cookies


class XiaohongshuScraper(BaseScraper):
    platform = "xiaohongshu"

    def extract_url(self, text: str) -> Optional[str]:
        for pat in _PATTERNS:
            m = pat.search(text)
            if m:
                return m.group(0)
        return None

    async def parse(self, url: str) -> ScraperResult:
        """Parse XHS URL. Runs sync Playwright in a thread pool to avoid
        Windows event loop issues with uvicorn."""
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(_executor, self._parse_sync, url)

    async def list_user_notes(
        self, user_id: str, cursor: Optional[str] = None
    ) -> AccountScanResult:
        """List all image notes from a Xiaohongshu user profile.

        Uses Playwright to load the profile page with cookies, then scrolls
        to trigger paginated API calls. The browser's XHS JS automatically
        adds required signing headers (x-s, x-t, x-s-common) to API requests.
        We intercept those signed responses to collect note data.
        """
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(_executor, self._list_user_notes_sync, user_id)

    def _list_user_notes_sync(self, user_id: str) -> AccountScanResult:
        """Sync Playwright-based profile scanner (runs in thread pool)."""
        from playwright.sync_api import sync_playwright

        cookie_str = _get_cookie()
        logger.info("Starting profile scan for user: %s", user_id)

        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            try:
                context = browser.new_context(
                    user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                               "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                    viewport={"width": 1280, "height": 900},
                )

                # Set cookies before navigation
                context.add_cookies(_parse_cookie_to_playwright(cookie_str))

                page = context.new_page()

                # Collect notes from intercepted API responses
                all_notes: list[NotePreview] = []
                seen_ids: set[str] = set()
                display_name = ""
                no_more = [False]

                def on_response(response):
                    nonlocal display_name
                    if "/api/sns/web/v1/user_posted" not in response.url:
                        return
                    try:
                        data = response.json()
                        if not data.get("success"):
                            return
                        notes_data = data.get("data", {}).get("notes", [])
                        if not data.get("data", {}).get("has_more"):
                            no_more[0] = True

                        for note in notes_data:
                            note_id = note.get("note_id", "")
                            if not note_id or note_id in seen_ids:
                                continue
                            seen_ids.add(note_id)

                            note_type = note.get("type", "normal")
                            if not display_name:
                                display_name = note.get("user", {}).get("nickname", "")

                            # Skip video notes
                            if note_type == "video":
                                continue

                            title = note.get("display_title", "").strip() or "未知标题"
                            image_list = note.get("image_list", [])
                            image_count = note.get("images_count", 0)
                            if not image_count:
                                image_count = len(image_list) if image_list else 1

                            # Extract full-res image URLs from image_list
                            image_urls: list[str] = []
                            for img in image_list:
                                img_info = img.get("info_list", [])
                                dft_url = None
                                for info in img_info:
                                    if info.get("image_scene") == "WB_DFT":
                                        dft_url = info.get("url", "")
                                        break
                                if not dft_url:
                                    dft_url = img.get("url_default") or img.get("url", "")
                                if dft_url:
                                    image_urls.append(_ensure_https(dft_url))

                            cover_url = None
                            cover = note.get("cover", {})
                            if cover:
                                info_list = cover.get("info_list", [])
                                if info_list:
                                    cover_url = info_list[-1].get("url", "")
                                if not cover_url:
                                    cover_url = cover.get("url", "") or cover.get("url_default", "")

                            published_at = None
                            ts = note.get("time")
                            if ts:
                                try:
                                    published_at = datetime.fromtimestamp(int(ts) / 1000)
                                except Exception:
                                    pass

                            all_notes.append(NotePreview(
                                note_id=note_id,
                                url=f"https://www.xiaohongshu.com/explore/{note_id}",
                                title=title,
                                media_count=image_count,
                                cover_url=cover_url,
                                published_at=published_at,
                                note_type="image",
                                image_urls=image_urls,
                            ))
                    except Exception as e:
                        logger.warning("Failed to parse user_posted response: %s", e)

                page.on("response", on_response)

                # Navigate to user profile
                profile_url = f"https://www.xiaohongshu.com/user/profile/{user_id}"
                logger.info("Loading profile page: %s", profile_url)
                page.goto(profile_url, wait_until="networkidle", timeout=30000)

                # Try to get display_name from page DOM if not captured from API
                if not display_name:
                    try:
                        display_name = page.evaluate("""
                            () => {
                                const el = document.querySelector('.user-name')
                                    || document.querySelector('.nickname')
                                    || document.querySelector('[class*="nickname"]');
                                return el ? el.textContent.trim() : '';
                            }
                        """) or ""
                    except Exception:
                        pass

                # Scroll to load all notes (XHS lazy-loads notes on scroll)
                max_scrolls = 100  # Safety limit
                stale_count = 0
                prev_len = len(all_notes)

                for i in range(max_scrolls):
                    if no_more[0]:
                        logger.info("API reports no more notes, stopping scroll")
                        break

                    page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
                    page.wait_for_timeout(2000)

                    curr_len = len(all_notes)
                    if curr_len == prev_len:
                        stale_count += 1
                        if stale_count >= 3:
                            logger.info("No new notes after 3 scrolls, stopping")
                            break
                    else:
                        stale_count = 0
                        prev_len = curr_len
                        logger.info("Scroll %d: collected %d image notes so far", i + 1, curr_len)

                logger.info("XHS profile scan complete: %d image notes found for %s",
                            len(all_notes), display_name or user_id)

                return AccountScanResult(
                    platform=self.platform,
                    username=user_id,
                    display_name=display_name,
                    notes=all_notes,
                    has_more=False,
                    cursor=None,
                )
            finally:
                browser.close()

    def _parse_sync(self, url: str) -> ScraperResult:
        """Run Playwright synchronously (avoids async event loop issues on Windows).

        Uses cookie-authenticated browser + API response interception.
        XHS blocks headless browsers from accessing note pages without auth,
        and with auth the __INITIAL_STATE__ is empty (client-side rendered).
        So we load the page with cookies and intercept the client-side API
        call that fetches note detail data.
        """
        from playwright.sync_api import sync_playwright

        cookie_str = _get_cookie()
        logger.info("Parsing Xiaohongshu URL: %s", url)

        # Extract note_id from URL for canonical URL construction
        note_id_match = re.search(r'/(?:explore|discovery/item)/([a-f0-9]+)', url)
        url_note_id = note_id_match.group(1) if note_id_match else None

        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            try:
                context = browser.new_context(
                    user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                    viewport={"width": 1280, "height": 900},
                )
                context.add_cookies(_parse_cookie_to_playwright(cookie_str))
                page = context.new_page()

                # Intercept note detail API response
                note_data_holder: list[dict] = []

                def on_response(response):
                    # XHS fetches note data via /api/sns/web/v1/feed
                    # or /api/sns/web/v2/note/... on client-side render
                    resp_url = response.url
                    if "/api/sns/web/v1/feed" in resp_url or "/api/sns/web/v2/note" in resp_url:
                        try:
                            data = response.json()
                            if data.get("success") or data.get("data"):
                                note_data_holder.append(data)
                                logger.info("Intercepted note API response from: %s", resp_url.split("?")[0])
                        except Exception as e:
                            logger.debug("Failed to parse API response: %s", e)

                page.on("response", on_response)

                # Navigate to note page with cookies (XHS will client-side render)
                canonical_url = f"https://www.xiaohongshu.com/explore/{url_note_id}" if url_note_id else url
                page.goto(canonical_url, wait_until="networkidle", timeout=30000)

                # Also try to grab __INITIAL_STATE__ as fallback
                html = page.content()
                final_url = page.url

                # Strategy 1: Parse from intercepted API response
                if note_data_holder:
                    result = self._parse_api_response(note_data_holder, url_note_id)
                    if result:
                        return result

                # Strategy 2: Parse from __INITIAL_STATE__ (may work for some pages)
                if html:
                    try:
                        return self._parse_html(html, final_url)
                    except RuntimeError:
                        pass

                raise RuntimeError("无法获取笔记数据，请检查 Cookie 是否有效")
            finally:
                browser.close()

    @staticmethod
    def _extract_video_url(video: dict) -> str | None:
        """Extract video URL from XHS video data, handling multiple nested structures."""
        # Structure 1: video.media.video.stream.{codec}[].masterUrl
        stream = video.get("media", {}).get("video", {}).get("stream", {})
        if not stream:
            # Structure 2: video.media.stream.{codec}[].masterUrl
            stream = video.get("media", {}).get("stream", {})
        if stream:
            for codec in ["h264", "h265", "av1", "h266"]:
                variants = stream.get(codec, [])
                if isinstance(variants, list):
                    for v in variants:
                        url = v.get("masterUrl") or v.get("url") or ""
                        if url.startswith("http"):
                            return url

        # Structure 3: flat fields on video or video.media
        for obj in [video.get("media", {}), video]:
            for key in ["url", "h264Url", "h265Url", "av1Url"]:
                url = obj.get(key, "")
                if isinstance(url, str) and url.startswith("http"):
                    return url

        # Structure 4: originVideoKey -> construct URL
        origin_key = video.get("consumer", {}).get("originVideoKey", "")
        if origin_key:
            url = f"https://sns-video-bd.xhscdn.com/{origin_key}"
            logger.info("Constructed video URL from originVideoKey: %s", url)
            return url

        logger.warning("Could not extract video URL from video data keys: %s", list(video.keys()))
        return None

    def _parse_api_response(self, responses: list[dict], url_note_id: str | None) -> ScraperResult | None:
        """Parse note data from intercepted client-side API responses."""
        for data in responses:
            try:
                # /api/sns/web/v1/feed response structure:
                # { "data": { "items": [{ "note_card": {...}, "id": "..." }] } }
                items = data.get("data", {}).get("items", [])
                if not items:
                    # /api/sns/web/v2/note response structure:
                    # { "data": { "note_card": {...} } } or similar
                    note_card = data.get("data", {})
                    if note_card and (note_card.get("title") or note_card.get("imageList")):
                        items = [{"note_card": note_card, "id": url_note_id or "unknown"}]

                for item in items:
                    note_card = item.get("note_card", {})
                    note_id = item.get("id") or url_note_id or "unknown"

                    # Skip if this is a different note (feed may return multiple)
                    if url_note_id and note_id != url_note_id:
                        continue

                    if not note_card:
                        continue

                    title = note_card.get("title", "").strip()
                    desc = note_card.get("desc", "").strip()
                    desc_clean = re.sub(r'\[话题\]#', '', desc)
                    display_title = title or desc_clean or "未知标题"

                    user = note_card.get("user", {})
                    nickname = user.get("nickname", "未知用户")
                    user_id = user.get("user_id") or user.get("userId", "unknown")

                    published_at = None
                    time_ms = note_card.get("time")
                    if time_ms:
                        try:
                            published_at = datetime.fromtimestamp(int(time_ms) / 1000)
                        except Exception:
                            pass

                    # Images
                    media_items: list[MediaItem] = []
                    for img in note_card.get("image_list", []) or note_card.get("imageList", []):
                        info_list = img.get("info_list", []) or img.get("infoList", [])
                        dft_url = None
                        prv_url = None
                        for info in info_list:
                            scene = info.get("image_scene") or info.get("imageScene", "")
                            u = info.get("url", "")
                            if not u:
                                continue
                            if scene == "WB_DFT":
                                dft_url = u
                            elif scene == "WB_PRV":
                                prv_url = u
                        if not dft_url:
                            dft_url = img.get("url_default") or img.get("urlDefault") or img.get("url", "")
                        if not prv_url:
                            prv_url = img.get("url_pre") or img.get("urlPre", "")

                        if dft_url:
                            media_items.append(MediaItem(
                                url=_ensure_https(dft_url),
                                type="image",
                                thumb_url=_ensure_https(prv_url) if prv_url else None,
                            ))

                    # Video
                    video = note_card.get("video", {})
                    if video:
                        vurl = self._extract_video_url(video)
                        if vurl:
                            media_items.append(MediaItem(url=vurl, type="video"))

                    if media_items:
                        canonical_url = f"https://www.xiaohongshu.com/explore/{note_id}"
                        logger.info("Parsed %d media items from API response for note %s", len(media_items), note_id)
                        return ScraperResult(
                            platform=self.platform,
                            source_url=canonical_url,
                            username=user_id,
                            display_name=nickname,
                            title=display_title,
                            published_at=published_at,
                            media_items=media_items,
                        )
            except Exception as e:
                logger.warning("Failed to parse API response: %s", e)
                continue
        return None

    def _parse_html(self, html: str, final_url: str) -> ScraperResult:
        """Parse note data from __INITIAL_STATE__ JSON embedded in HTML."""
        m = _INITIAL_STATE_RE.search(html)
        if not m:
            raise RuntimeError("页面中未找到笔记数据，可能链接无效或已被删除")

        raw = m.group(1).replace("undefined", "null")
        try:
            data = json.loads(raw)
        except json.JSONDecodeError as e:
            raise RuntimeError(f"解析页面数据失败: {e}")

        # Find note in noteDetailMap
        note_map = data.get("note", {}).get("noteDetailMap", {})
        if not note_map:
            raise RuntimeError("未找到笔记详情数据")

        # Get first (usually only) note
        note_id = next(iter(note_map))
        note_data = note_map[note_id].get("note", {})

        # Title & description
        title = note_data.get("title", "").strip()
        desc = note_data.get("desc", "").strip()
        # Clean topic tags from desc: #xxx[话题]# → #xxx
        desc_clean = re.sub(r'\[话题\]#', '', desc)
        display_title = title or desc_clean or "未知标题"

        # Author
        user = note_data.get("user", {})
        nickname = user.get("nickname", "未知用户")
        user_id = user.get("userId", "unknown")

        # Publish time (millisecond timestamp)
        published_at = None
        time_ms = note_data.get("time")
        if time_ms:
            try:
                published_at = datetime.fromtimestamp(int(time_ms) / 1000)
            except Exception:
                pass

        # Images
        media_items: list[MediaItem] = []
        for img in note_data.get("imageList", []):
            info_list = img.get("infoList", [])
            # Prefer WB_DFT (default/full size), fallback to WB_PRV (preview)
            dft_url = None
            prv_url = None
            for info in info_list:
                scene = info.get("imageScene", "")
                u = info.get("url", "")
                if not u:
                    continue
                if scene == "WB_DFT":
                    dft_url = u
                elif scene == "WB_PRV":
                    prv_url = u
            # Also check urlDefault / urlPre at image level
            if not dft_url:
                dft_url = img.get("urlDefault") or img.get("url", "")
            if not prv_url:
                prv_url = img.get("urlPre", "")

            if dft_url:
                media_items.append(MediaItem(
                    url=_ensure_https(dft_url),
                    type="image",
                    thumb_url=_ensure_https(prv_url) if prv_url else None,
                ))

        # Video
        video = note_data.get("video", {})
        if video:
            vurl = self._extract_video_url(video)
            if vurl:
                media_items.append(MediaItem(url=vurl, type="video"))

        # Normalize source_url to canonical /explore/{note_id} format for dedup
        canonical_url = f"https://www.xiaohongshu.com/explore/{note_id}"

        return ScraperResult(
            platform=self.platform,
            source_url=canonical_url,
            username=user_id,
            display_name=nickname,
            title=display_title,
            published_at=published_at,
            media_items=media_items,
        )
