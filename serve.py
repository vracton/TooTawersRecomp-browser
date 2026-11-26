import argparse
import hashlib
import json
import mimetypes
import re
from functools import partial
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

from generate import XBE_SHA256, find_xbe
from launcher_assets import load_launcher_art, load_launcher_font, load_launcher_ring


ROOT = Path(__file__).resolve().parent
RANGE = re.compile(r"bytes=(\d*)-(\d*)")


class GameHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def __init__(self, *args, disc, build, launcher_assets, **kwargs):
        self.disc = disc
        self.build = build
        self.launcher_assets = launcher_assets
        super().__init__(*args, **kwargs)

    def end_headers(self):
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_HEAD(self):
        self.serve(body=False)

    def do_GET(self):
        self.serve(body=True)

    def serve(self, body):
        route = unquote(urlsplit(self.path).path)
        if route == "/disc.json":
            self.send_manifest(body)
            return
        if route in self.launcher_assets:
            content_type, data = self.launcher_assets[route]
            self.send_bytes(data, content_type, body)
            return

        if route.startswith("/disc/"):
            key = re.sub(r"/+", "/", route[len("/disc/"):]).lstrip("/")
            file = self.disc.get(key)
        else:
            try:
                file = (self.build / (route.lstrip("/") or "index.html")).resolve()
                if not file.is_relative_to(self.build):
                    file = None
            except (OSError, ValueError):
                file = None

        if file is None:
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        try:
            with file.open("rb") as source:
                self.send_file(file, source, body)
        except (FileNotFoundError, IsADirectoryError, PermissionError):
            self.send_error(HTTPStatus.NOT_FOUND)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def send_manifest(self, body):
        manifest = json.dumps(sorted(self.disc)).encode("utf-8")
        self.send_bytes(manifest, "application/json; charset=utf-8", body)

    def send_bytes(self, data, content_type, body):
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        if body:
            self.wfile.write(data)

    def send_file(self, file, source, body):
        size = source.seek(0, 2)
        start, end = 0, size
        status = HTTPStatus.OK
        requested = self.headers.get("Range")
        if requested:
            match = RANGE.fullmatch(requested)
            if match:
                first, last = match.groups()
                if first:
                    start = int(first)
                    end = min(int(last) + 1, size) if last else size
                elif last:
                    start = max(0, size - int(last))
                else:
                    end = 0
            if not match or start >= end:
                self.send_response(HTTPStatus.REQUESTED_RANGE_NOT_SATISFIABLE)
                self.send_header("Content-Range", f"bytes */{size}")
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            status = HTTPStatus.PARTIAL_CONTENT

        self.send_response(status)
        self.send_header("Content-Type", mimetypes.guess_type(file.name)[0] or "application/octet-stream")
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(end - start))
        if status == HTTPStatus.PARTIAL_CONTENT:
            self.send_header("Content-Range", f"bytes {start}-{end - 1}/{size}")
        self.end_headers()
        if body:
            source.seek(start)
            remaining = end - start
            while remaining:
                chunk = source.read(min(remaining, 256 * 1024))
                if not chunk:
                    break
                self.wfile.write(chunk)
                remaining -= len(chunk)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--disc", type=Path, default=ROOT.parent / "twotowers")
    parser.add_argument("--build", type=Path, default=ROOT / "build-web")
    parser.add_argument("--port", type=int, default=8080)
    args = parser.parse_args()
    disc_root = args.disc.resolve()
    with open(find_xbe(disc_root), "rb") as source:
        digest = hashlib.sha256(source.read()).hexdigest()
    if digest != XBE_SHA256:
        parser.error("The disc folder must contain the USA retail default.xbe.")

    disc = {}
    for path in disc_root.rglob("*"):
        if not path.is_file():
            continue
        target = path.resolve()
        if not target.is_relative_to(disc_root):
            continue
        key = path.relative_to(disc_root).as_posix().lower()
        if key in disc:
            parser.error(f"Disc names differ only by case: {key}")
        disc[key] = target

    mimetypes.add_type("application/wasm", ".wasm")
    options = disc.get("ui/options.bff")
    assets = {
        "/launcher-art.png": ("image/png", load_launcher_art(options)),
        "/launcher-ring.png": ("image/png", load_launcher_ring(options)),
        "/launcher-font.json": ("application/json", load_launcher_font(disc.get("ui/startup.bff"))),
    }
    handler = partial(GameHandler, disc=disc, build=args.build.resolve(),
                      launcher_assets={route: asset for route, asset in assets.items() if asset[1]})
    with ThreadingHTTPServer(("127.0.0.1", args.port), handler) as server:
        print(f"http://127.0.0.1:{server.server_port}", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
