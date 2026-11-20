"""Build the frontend as a static site (Netlify or any static host) that talks to the Makon API server.

    python3 scripts/build_static.py https://makon-5e00.onrender.com

Writes dist/: the frontend files, index.html pointing at the API, and sw.js with its build id and
offline asset list filled in (the API server normally does this when it serves sw.js itself).
The API server must list the static site's origin in CORS_ORIGINS.
"""
import hashlib
import json
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FRONTEND = ROOT / "frontend"
DIST = ROOT / "dist"


def shell_assets() -> list:
    out = ["/"]
    for path in sorted(FRONTEND.rglob("*")):
        rel = path.relative_to(FRONTEND).as_posix()
        if path.is_file() and not rel.startswith(("vendor/", "download/", ".")) and "/." not in rel \
                and rel not in ("sw.js", "index.html"):
            out.append("/" + rel)
    return out


def build_id(api: str) -> str:
    h = hashlib.sha256(api.encode())
    for path in sorted(FRONTEND.rglob("*")):
        if path.is_file() and path.name != "sw.js" and not path.name.endswith(".apk"):
            h.update(str(path.relative_to(FRONTEND)).encode())
            h.update(path.read_bytes())
    return h.hexdigest()[:12]


def main() -> None:
    if len(sys.argv) != 2 or not sys.argv[1].startswith("https://"):
        sys.exit("usage: python3 scripts/build_static.py https://your-api-server")
    api = sys.argv[1].rstrip("/")
    if DIST.exists():
        shutil.rmtree(DIST)
    shutil.copytree(FRONTEND, DIST, ignore=shutil.ignore_patterns(".DS_Store"))

    index = DIST / "index.html"
    html = index.read_text(encoding="utf-8")
    html = html.replace('<meta charset="utf-8">', f'<meta charset="utf-8">\n  <meta name="makon-api" content="{api}">', 1)
    index.write_text(html, encoding="utf-8")

    sw = DIST / "sw.js"
    sw.write_text(sw.read_text(encoding="utf-8").replace("__BUILD__", build_id(api))
                  .replace("__ASSETS__", json.dumps(shell_assets())), encoding="utf-8")

    privacy = DIST / "privacy.html"
    privacy.write_text(privacy.read_text(encoding="utf-8").replace("CONTACT_EMAIL", "—")
                       .replace('href="mailto:—"', 'href="#"'), encoding="utf-8")
    print(f"dist/ ready → API {api}")


if __name__ == "__main__":
    main()
