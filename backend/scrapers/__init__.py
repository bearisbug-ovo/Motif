from .xiaohongshu import XiaohongshuScraper
from .douyin import DouyinScraper

SCRAPERS = [XiaohongshuScraper(), DouyinScraper()]


def get_scraper(text: str):
    """Find the first scraper that can handle the given text."""
    for s in SCRAPERS:
        if s.extract_url(text):
            return s
    return None
