"""CPIN Explorer: import verified local archive downloads, with no network access."""
import argparse
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from cpin.archive_import import browser_copies, reconcile_catalogue, register_copies, repository_copies
from cpin.store import Store, write_json


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, default=Path("data"))
    args = parser.parse_args()
    store = Store(args.data)
    folder = args.data / "pdfs" / "national-archives"
    records = browser_copies(json.loads((folder / "download-report.json").read_text()))
    records += repository_copies(json.loads((folder / "repository-downloads.json").read_text()))
    result = {"import": register_copies(store, records), "catalogue": reconcile_catalogue(store)}
    write_json(folder / "import-report.json", result)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
