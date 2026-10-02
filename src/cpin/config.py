"""Settings shared by the pipeline."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / "data"

# One honest User-Agent: no browser impersonation and no personal contact details.
USER_AGENT = "cpin-extractor/0.1 (+https://github.com/RobertsMacros/cpin-extractor)"

GOVUK = "https://www.gov.uk"
CONTENT_API = GOVUK + "/api/content"
COLLECTION_PATH = "/government/collections/country-policy-and-information-notes"

# Minimum seconds between requests to the same host. robots.txt Crawl-delay wins if larger.
HOST_DELAY = {
    "www.gov.uk": 0.4,
    "assets.publishing.service.gov.uk": 0.4,
    "web.archive.org": 1.5,
}
DEFAULT_DELAY = 1.0
