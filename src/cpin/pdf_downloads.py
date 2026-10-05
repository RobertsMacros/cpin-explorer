"""Save exact PDF links serially, without changing the mirror or printing/recreating PDFs."""
import argparse
from hashlib import sha256
from pathlib import Path
from urllib.parse import urlsplit
from uuid import uuid4

from .http import PoliteClient
from .recover import page_count, pdf_problem
from .store import now_iso, write_json


def read_links(path: Path) -> list[str]:
    links = []
    for number, line in enumerate(path.read_text('utf-8-sig').splitlines(), 1):
        url = line.strip()
        if not url or url.startswith('#'):
            continue
        p = urlsplit(url)
        if p.scheme not in {'https', 'http'} or not p.hostname or p.username or p.password:
            raise ValueError(f'Line {number}: supply one complete HTTP(S) PDF link')
        if any(c.isspace() for c in url) or p.fragment:
            raise ValueError(f'Line {number}: remove spaces and page/text fragments from the link')
        if '/timeline/' in p.path:
            raise ValueError(f'Line {number}: this is an archive timeline; choose a dated PDF capture first')
        if url not in links:
            links.append(url)
    if not links:
        raise ValueError('The list has no PDF links')
    return links


def download_links(links: list[str], out: Path, client: PoliteClient) -> list[dict]:
    """Return one outcome per URL. Blocked requests and failed files remain visible."""
    out.mkdir(parents=True, exist_ok=True)
    records = []
    for url in links:
        record = {'url': url, 'checked_at': now_iso()}
        records.append(record)
        result = client.get(url, follow=True, accept='application/pdf')
        record['final_url'] = result.url
        if not result.ok:
            record.update(status='failed', error=result.error or f'HTTP {result.status}')
            continue
        problem = pdf_problem(result.content)
        if problem:
            record.update(status='failed', error=problem)
            continue
        pages = page_count(result.content)
        if not pages:
            record.update(status='failed', error='The PDF cannot be opened or has no pages')
            continue
        digest = sha256(result.content).hexdigest()
        path = out / f'{digest}.pdf'
        try:
            if path.exists():
                if sha256(path.read_bytes()).hexdigest() != digest:
                    record.update(status='failed', error='Existing file has the wrong hash; left unchanged')
                    continue
                status = 'already saved'
            else:
                # Exclusive creation: no existing PDF is replaced, even if another process writes it.
                with path.open('xb') as target:
                    target.write(result.content)
                status = 'saved'
        except OSError as error:
            record.update(status='failed', error=f'Could not save file: {error}')
            continue
        record.update(status=status, file=path.name, sha256=digest, bytes=len(result.content), pages=pages)
    return records


def main(argv=None):
    parser = argparse.ArgumentParser(description='CPIN Explorer: save original PDFs from exact links, serially')
    parser.add_argument('links', type=Path, help='UTF-8 text file: one exact PDF link per line')
    parser.add_argument('--out', type=Path, required=True, help='Folder for PDFs and the download report')
    args = parser.parse_args(argv)
    try:
        links = read_links(args.links)
    except (OSError, ValueError) as error:
        parser.error(str(error))
    with PoliteClient(max_retries=1) as client:
        records = download_links(links, args.out, client)
    # Keep previous run reports rather than overwriting them.
    report = args.out / f'download-report-{now_iso().replace(":", "-")}-{uuid4().hex}.json'
    write_json(report, {'tool': 'CPIN Explorer', 'records': records})
    for record in records:
        print(f'{record["status"]}: {record["url"]}' + (f' — {record["error"]}' if record.get('error') else ''))
    failed = sum(r['status'] == 'failed' for r in records)
    print(f'{len(records) - failed} saved/already saved · {failed} failed · report: {report}')
    return 1 if failed else 0


if __name__ == '__main__':
    raise SystemExit(main())
