"""GOV.UK Content API shapes: the CPIN collection, country publications and HTML notes."""
from urllib.parse import urlsplit

from . import config

PUBLICATION_SUFFIX = "-country-policy-and-information-notes"


def api_url(base_path: str) -> str:
    return config.CONTENT_API + urlsplit(base_path).path


def country_slug(base_path: str) -> str:
    """'/government/publications/kenya-country-policy-and-information-notes' -> 'kenya'."""
    return base_path.rstrip("/").rsplit("/", 1)[-1].removesuffix(PUBLICATION_SUFFIX)


def note_slug(attachment_url: str) -> str:
    return urlsplit(attachment_url).path.rstrip("/").rsplit("/", 1)[-1]


def country_name(title: str) -> str:
    """'Kenya: country policy and information notes' -> 'Kenya'."""
    return title.split(":", 1)[0].strip()


def collection_documents(collection: dict) -> list[dict]:
    return [{
        "title": d["title"],
        "name": country_name(d["title"]),
        "slug": country_slug(d["base_path"]),
        "base_path": d["base_path"],
        "content_id": d.get("content_id"),
        "public_updated_at": d.get("public_updated_at"),
        "withdrawn": bool(d.get("withdrawn")),
    } for d in collection.get("links", {}).get("documents", [])]


def _attachments(publication: dict, kind: str) -> list[dict]:
    return [a for a in publication.get("details", {}).get("attachments", [])
            if a.get("attachment_type") == kind]


def html_attachments(publication: dict) -> list[dict]:
    return _attachments(publication, "html")


def file_attachments(publication: dict) -> list[dict]:
    return _attachments(publication, "file")


def split_item(item: dict) -> tuple[str | None, dict]:
    """Separate a content item's body from everything else, without altering either."""
    details = dict(item.get("details") or {})
    body = details.pop("body", None)
    meta = dict(item)
    meta["details"] = details
    return body, meta
