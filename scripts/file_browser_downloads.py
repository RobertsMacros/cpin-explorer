"""File original browser-downloaded PDFs, validate them and keep source records (no network)."""
import argparse
import csv
from hashlib import sha256
import json
import os
from pathlib import Path
import re
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src'))
from cpin.recover import page_count, pdf_problem


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('folder', type=Path)
    parser.add_argument('--tool-log', type=Path, help='Read only CPIN download records from this chat log')
    parser.add_argument('--limit', type=int, help='Number of queue entries included in this run')
    parser.add_argument('--titles', type=Path, help='CSV linking captures to country and edition titles')
    args = parser.parse_args()
    root = args.folder
    queue = (root / 'queue.txt').read_text().splitlines()
    limit = args.limit or len(queue)
    if not 0 < limit <= len(queue):
        parser.error('limit must be within the queue')
    if args.tool_log:
        offset_file = root / 'tool-log-offset.txt'
        offset = int(offset_file.read_text()) if offset_file.exists() else 0
        collected = []

        def visit(value):
            if isinstance(value, dict):
                for item in value.values():
                    visit(item)
            elif isinstance(value, list):
                for item in value:
                    visit(item)
            elif isinstance(value, str) and value.startswith('CPIN_BROWSER_RECORDS='):
                collected.extend(json.JSONDecoder().raw_decode(value.split('=', 1)[1])[0])
            elif isinstance(value, str) and value.startswith('CPIN_BROWSER_PACKED='):
                packed = json.JSONDecoder().raw_decode(value.split('=', 1)[1])[0]
                for index, name_index, suffix in packed['records']:
                    if name_index < 0:
                        collected.append({'index': index, 'status': 'failed', 'error': suffix})
                        continue
                    name = packed['names'][name_index]
                    if suffix is not None:
                        stem, extension = name.rsplit('.', 1)
                        name = f'{stem} ({suffix}).{extension}'
                    collected.append({'index': index, 'status': 'downloaded',
                                      'path': str(Path.home() / 'Downloads' / name)})

        with args.tool_log.open('rb') as f:
            f.seek(offset)
            while True:
                line = f.readline()
                if not line or not line.endswith(b'\n'):
                    break
                visit(json.loads(line))
                offset = f.tell()
        with (root / 'browser-downloads.jsonl').open('a') as f:
            for record in collected:
                f.write(json.dumps(record) + '\n')
        offset_file.write_text(str(offset))
    previous = {}
    report = root / 'download-report.json'
    if report.exists():
        previous = {r['index']: r for r in json.loads(report.read_text())['records']}
    for line in (root / 'browser-downloads.jsonl').read_text().splitlines():
        raw = json.loads(line)
        index = raw['index']
        if not 0 <= index < limit:
            continue
        if index in previous and previous[index]['status'] == 'saved':
            continue
        record = {'index': index, 'url': queue[index], **raw}
        if raw['status'] != 'downloaded':
            previous[index] = record
            continue
        source = Path(raw['path'])
        try:
            body = source.read_bytes()
            problem = pdf_problem(body)
            pages = page_count(body) if not problem else 0
            if problem or not pages:
                raise ValueError(problem or 'PDF cannot be opened or has no pages')
            digest = sha256(body).hexdigest()
            target = root / 'files' / f'{digest}.pdf'
            if target.exists():
                if sha256(target.read_bytes()).hexdigest() != digest:
                    raise ValueError('Existing file has wrong hash; left unchanged')
            else:
                with target.open('xb') as f:
                    f.write(body)
            record.update(status='saved', sha256=digest, bytes=len(body), pages=pages,
                          file=str(target.relative_to(root)))
        except (OSError, ValueError) as error:
            record.update(status='failed', error=str(error))
        previous[index] = record
    records = [previous[i] for i in sorted(previous)]
    if args.titles:
        with args.titles.open() as f:
            titles = {r['archive_link']: r for r in csv.DictReader(f)}
        for record in records:
            if record['status'] != 'saved' or record['url'] not in titles:
                continue
            metadata = titles[record['url']]
            country = re.sub(r'[/:\x00]', '-', metadata['country'])
            title = re.sub(r'[/:\x00]', '-', metadata['edition']).strip()[:170]
            folder = root / 'By country' / country
            folder.mkdir(parents=True, exist_ok=True)
            named = folder / f'{title} [{record["sha256"][:12]}].pdf'
            if not named.exists():
                os.link(root / record['file'], named)
            record.update(country=metadata['country'], edition=metadata['edition'],
                          named_file=str(named.relative_to(root)))
        with (root / 'Capture index.csv').open('w', newline='') as f:
            columns = ['country', 'edition', 'named_file', 'url', 'sha256', 'pages', 'bytes']
            writer = csv.DictWriter(f, fieldnames=columns, extrasaction='ignore')
            writer.writeheader()
            writer.writerows(r for r in records if r['status'] == 'saved')
        unique = {}
        for record in records:
            if record['status'] != 'saved':
                continue
            key = record.get('named_file', record['file'])
            if key not in unique:
                unique[key] = {**record, 'capture_count': 0}
            unique[key]['capture_count'] += 1
        with (root / 'PDF index.csv').open('w', newline='') as f:
            columns = ['country', 'edition', 'named_file', 'capture_count', 'url',
                       'sha256', 'pages', 'bytes']
            writer = csv.DictWriter(f, fieldnames=columns, extrasaction='ignore')
            writer.writeheader()
            writer.writerows(sorted(unique.values(), key=lambda r: (
                r.get('country', ''), r.get('edition', ''), r['sha256'])))
    saved = sum(r['status'] == 'saved' for r in records)
    failed = sum(r['status'] != 'saved' for r in records)
    summary = {'tool': 'CPIN Explorer', 'total_links': limit, 'saved_captures': saved,
               'unique_pdfs': len({r['sha256'] for r in records if r['status'] == 'saved'}),
               'failed': failed, 'pending': limit - len(records), 'records': records}
    temporary = root / 'download-report.tmp'
    temporary.write_text(json.dumps(summary, indent=2) + '\n')
    temporary.replace(report)
    # These browser files were created by this run. The validated bytes and source record
    # are already preserved above; remove only redundant copies directly in Downloads.
    for record in records:
        if record['status'] != 'saved':
            continue
        source = Path(record['path'])
        if source.parent == Path.home() / 'Downloads' and source.exists():
            if sha256(source.read_bytes()).hexdigest() == record['sha256']:
                source.unlink()
    print(json.dumps({k: v for k, v in summary.items() if k != 'records'}))


if __name__ == '__main__':
    main()
