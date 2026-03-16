"""Douyin (抖音) scraper using cookie-based HTTP requests.

Strategy: With valid login cookies, fetch the page HTML which contains
React Server Components flight data (self.__pace_f.push) with all post
metadata (images, video, author, title). No Playwright needed.

Account scanning uses the internal /aweme/v1/web/aweme/post/ API to
paginate through all posts from a user.
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
from datetime import datetime
from typing import Optional

import httpx

from .base import (
    AccountScanResult,
    BaseScraper,
    MediaItem,
    NotePreview,
    ScraperResult,
)

logger = logging.getLogger("motif.scraper.douyin")

# URL patterns for Douyin
_PATTERNS = [
    re.compile(r'https?://(?:www\.)?douyin\.com/(?:note|video)/(\d+)'),
    re.compile(r'https?://(?:www\.)?douyin\.com/user/[A-Za-z0-9_-]+\?[^\s]*modal_id=(\d+)'),
    re.compile(r'https?://v\.douyin\.com/\w+'),
]

_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
}

# aweme_type 68 = image note (图文笔记)
_IMAGE_NOTE_TYPE = 68
# Delay between pagination requests to avoid rate limiting
_PAGE_DELAY = 1.5


def _get_cookie() -> str:
    from config import get_settings
    cookie = get_settings().platform_cookies.get("douyin", "")
    if not cookie:
        raise RuntimeError(
            "请先在「设置 → 服务」中配置抖音 Cookie（从浏览器复制登录后的 Cookie）"
        )
    return cookie


class DouyinScraper(BaseScraper):
    platform = "douyin"

    def extract_url(self, text: str) -> Optional[str]:
        for pat in _PATTERNS:
            m = pat.search(text)
            if m:
                url = m.group(0)
                # Normalize /user/...?modal_id=xxx → /note/xxx
                modal_match = re.search(r'modal_id=(\d+)', url)
                if modal_match and '/user/' in url:
                    return f"https://www.douyin.com/note/{modal_match.group(1)}"
                return url
        return None

    async def parse(self, url: str) -> ScraperResult:
        cookie_str = _get_cookie()

        # Resolve short links (v.douyin.com)
        if "v.douyin.com" in url:
            url = await self._resolve_short_link(url, cookie_str)

        logger.info("Parsing Douyin URL: %s", url)

        async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
            headers = {**_HEADERS, "Cookie": cookie_str, "Referer": "https://www.douyin.com/"}
            resp = await client.get(url, headers=headers)
            resp.raise_for_status()
            html = resp.text

        return self._parse_html(html, url)

    async def list_user_notes(
        self, user_id: str, cursor: Optional[str] = None
    ) -> AccountScanResult:
        """List all image notes from a Douyin user via internal API.

        Args:
            user_id: The sec_user_id (secUid) of the user.
            cursor: Pagination cursor (max_cursor from previous call).
        """
        cookie_str = _get_cookie()
        headers = {**_HEADERS, "Cookie": cookie_str, "Referer": "https://www.douyin.com/"}

        all_notes: list[NotePreview] = []
        max_cursor = int(cursor) if cursor else 0
        has_more = True
        display_name = ""

        async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
            while has_more:
                params = {
                    "sec_user_id": user_id,
                    "count": 18,
                    "max_cursor": max_cursor,
                    "device_platform": "webapp",
                    "aid": "6383",
                }
                resp = await client.get(
                    "https://www.douyin.com/aweme/v1/web/aweme/post/",
                    params=params,
                    headers=headers,
                )
                resp.raise_for_status()
                data = resp.json()

                if data.get("status_code") != 0:
                    raise RuntimeError(f"API 返回错误：{data.get('status_msg', '未知错误')}")

                aweme_list = data.get("aweme_list") or []
                for aweme in aweme_list:
                    # Get display_name from first result
                    if not display_name:
                        display_name = aweme.get("author", {}).get("nickname", "")

                    # Only collect image notes
                    if aweme.get("aweme_type") != _IMAGE_NOTE_TYPE:
                        continue

                    images = aweme.get("images") or []
                    if not images:
                        continue

                    aweme_id = aweme.get("aweme_id", "")
                    desc = aweme.get("desc", "").strip()

                    # Cover: first image thumbnail
                    cover_url = None
                    if images:
                        cover_urls = images[0].get("url_list", [])
                        cover_url = cover_urls[0] if cover_urls else None

                    published_at = None
                    ct = aweme.get("create_time")
                    if ct:
                        try:
                            published_at = datetime.fromtimestamp(int(ct))
                        except Exception:
                            pass

                    all_notes.append(NotePreview(
                        note_id=aweme_id,
                        url=f"https://www.douyin.com/note/{aweme_id}",
                        title=desc or "未知标题",
                        media_count=len(images),
                        cover_url=cover_url,
                        published_at=published_at,
                        note_type="image",
                    ))

                has_more = bool(data.get("has_more"))
                max_cursor = data.get("max_cursor", 0)

                if has_more:
                    logger.info("Scanned %d notes so far, fetching next page...", len(all_notes))
                    await asyncio.sleep(_PAGE_DELAY)

        logger.info("Scan complete: %d image notes found", len(all_notes))

        return AccountScanResult(
            platform=self.platform,
            username=user_id,
            display_name=display_name,
            notes=all_notes,
            has_more=False,
            cursor=None,
        )

    async def _resolve_short_link(self, url: str, cookie_str: str) -> str:
        """Resolve v.douyin.com short link to full URL."""
        async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
            headers = {**_HEADERS, "Cookie": cookie_str}
            resp = await client.get(url, headers=headers)
            final_url = str(resp.url)
            m = re.search(r'https?://(?:www\.)?douyin\.com/(?:note|video)/\d+', final_url)
            if m:
                return m.group(0)
            m = re.search(r'https?://(?:www\.)?douyin\.com/(?:note|video)/\d+', resp.text)
            if m:
                return m.group(0)
            raise RuntimeError(f"无法解析短链接：{url}，跳转到了 {final_url}")

    def _parse_html(self, html: str, url: str) -> ScraperResult:
        """Extract aweme detail from React Server Components flight data."""
        detail = self._extract_detail_from_rsc(html)
        if not detail:
            raise RuntimeError(
                "页面中未找到作品数据，Cookie 可能已过期或链接无效"
            )

        # Description (title)
        desc = detail.get("desc", "").strip()
        title = desc or "未知标题"

        # Author — in 'authorInfo' (camelCase)
        author = detail.get("authorInfo", {})
        nickname = author.get("nickname", "未知用户")
        # Use sec_uid as username — it's the identifier needed for API calls
        sec_uid = str(author.get("secUid", ""))
        uid = sec_uid or str(author.get("uid", ""))

        # Publish time — 'createTime' (unix seconds)
        published_at = None
        create_time = detail.get("createTime")
        if create_time:
            try:
                published_at = datetime.fromtimestamp(int(create_time))
            except Exception:
                pass

        # Extract media
        media_items: list[MediaItem] = []

        # Images (note type posts) — camelCase: urlList, downloadUrlList
        images = detail.get("images") or []
        for img in images:
            img_url = self._best_image_url(img)
            if img_url:
                url_list = img.get("urlList", [])
                thumb = url_list[0] if len(url_list) > 1 else None
                media_items.append(MediaItem(
                    url=img_url,
                    type="image",
                    thumb_url=thumb,
                ))

        # Video (only if no images)
        video = detail.get("video", {})
        if video and not images:
            video_url = self._extract_video_url(video)
            if video_url:
                cover = video.get("cover", {}).get("urlList", [])
                thumb = cover[-1] if cover else None
                media_items.append(MediaItem(
                    url=video_url,
                    type="video",
                    thumb_url=thumb,
                ))

        return ScraperResult(
            platform=self.platform,
            source_url=url,
            username=uid,
            display_name=nickname,
            title=title,
            published_at=published_at,
            media_items=media_items,
            extra={"sec_uid": sec_uid},
        )

    @staticmethod
    def _best_image_url(img: dict) -> Optional[str]:
        """Pick the best quality image URL from a Douyin image object.

        urlList typically has 3 entries: [webp, webp, jpeg].
        The JPEG variant (~564KB) preserves slightly more detail than
        WEBP q75 (~444KB). Prefer JPEG when available.
        """
        url_list = img.get("urlList", [])
        for u in reversed(url_list):
            if ".jpeg" in u or ".jpg" in u:
                return u
        if url_list:
            return url_list[-1]
        return None

    @staticmethod
    def _extract_video_url(video: dict) -> Optional[str]:
        """Extract best video URL from video data (camelCase fields)."""
        play_addr = video.get("playAddr", {})
        url_list = play_addr.get("urlList", [])
        for vu in url_list:
            if vu and vu.startswith("http"):
                return vu

        bit_rate_list = video.get("bitRateList", [])
        if bit_rate_list:
            best = max(bit_rate_list, key=lambda x: x.get("bitRate", 0))
            play = best.get("playAddr", {}).get("urlList", [])
            if play:
                return play[0]

        h265 = video.get("playAddrH265", {}).get("urlList", [])
        if h265:
            return h265[0]

        return None

    @staticmethod
    def _extract_detail_from_rsc(html: str) -> Optional[dict]:
        """Extract aweme detail from self.__pace_f.push() RSC flight data."""
        pushes = re.findall(r'self\.__pace_f\.push\(\[(.*?)\]\)', html, re.DOTALL)

        for raw_push in pushes:
            if "awemeId" not in raw_push:
                continue
            try:
                arr = json.loads("[" + raw_push + "]")
                if len(arr) < 2 or not isinstance(arr[1], str):
                    continue
                rsc_line = arr[1]
                colon_idx = rsc_line.index(":")
                payload_str = rsc_line[colon_idx + 1:].strip()
                payload = json.loads(payload_str)
                if isinstance(payload, list) and len(payload) >= 4:
                    wrapper = payload[3]
                    if isinstance(wrapper, dict) and "aweme" in wrapper:
                        aweme = wrapper["aweme"]
                        detail = aweme.get("detail")
                        if isinstance(detail, dict):
                            return detail
            except (json.JSONDecodeError, ValueError, IndexError, TypeError):
                continue

        return None
