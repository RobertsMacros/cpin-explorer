"""Run with .venv/bin/python scripts/save_pdf_links.py LINKS.txt --out FOLDER."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src'))
from cpin.pdf_downloads import main

if __name__ == '__main__':
    raise SystemExit(main())
