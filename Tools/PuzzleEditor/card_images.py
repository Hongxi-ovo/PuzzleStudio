"""Complete card pictures: bundled fallback, asynchronous HQ download, disk cache."""
from concurrent.futures import ThreadPoolExecutor
import os
from pathlib import Path
import struct
import threading
import time
from urllib.request import Request, urlopen
import zipfile

IMAGE_URL = "https://cdn02.moecube.com:444/ygomobile-images/{code}.jpg"
MAX_IMAGE_BYTES = 8 * 1024 * 1024


def image_size(data):
    """Read enough of JPEG/PNG headers to reject HTML, corrupt and landscape data."""
    if data.startswith(b"\x89PNG\r\n\x1a\n") and len(data) >= 24:
        return struct.unpack(">II", data[16:24])
    if not data.startswith(b"\xff\xd8") or not data.endswith(b"\xff\xd9"):
        return None
    offset = 2
    while offset + 4 <= len(data):
        if data[offset] != 255:
            return None
        while offset < len(data) and data[offset] == 255:
            offset += 1
        if offset >= len(data):
            return None
        marker = data[offset]
        offset += 1
        if marker in (1, *range(0xD0, 0xD9)):
            continue
        length = int.from_bytes(data[offset:offset + 2], "big")
        if length < 2 or offset + length > len(data):
            return None
        if marker in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
            if length < 7:
                return None
            height, width = struct.unpack(">HH", data[offset + 3:offset + 7])
            return width, height
        offset += length
    return None


def valid_picture(data):
    size = image_size(data)
    return bool(size and size[0] >= 100 and size[1] >= 140 and 0.55 < size[0] / size[1] < 0.82)


class CardPictures:
    def __init__(self, assets, cache=None, opener=urlopen, clock=time.monotonic):
        self.assets = Path(assets)
        self.cache = Path(cache or Path(os.environ.get("LOCALAPPDATA", str(Path.home()))) / "MDPro3/PuzzleStudio/CardImages")
        self.cache.mkdir(parents=True, exist_ok=True)
        self.opener, self.clock = opener, clock
        self.pool = ThreadPoolExecutor(max_workers=3, thread_name_prefix="card-picture")
        self.lock = threading.Lock()
        self.pending, self.retry_after = set(), {}
        self.fallback = {}
        archive = self.assets / "pics.zip"
        self.archive = zipfile.ZipFile(archive) if archive.exists() else None
        if self.archive:
            import re
            for name in self.archive.namelist():
                match = re.fullmatch(r"(?:pics/)?([0-9]+)\.(jpg|png)", name, re.I)
                if match:
                    self.fallback[int(match[1])] = name

    def cached(self, code):
        path = self.cache / f"{code}.jpg"
        try:
            if path.is_file() and path.stat().st_size <= MAX_IMAGE_BYTES:
                data = path.read_bytes()
                if valid_picture(data):
                    return data
        except OSError:
            pass
        return None

    def version(self, code):
        path = self.cache / f"{code}.jpg"
        try:
            return str(path.stat().st_mtime_ns) if self.cached(code) else ""
        except OSError:
            return ""

    def picture(self, code):
        data = self.cached(code)
        if data:
            return data, "image/png" if data.startswith(b"\x89PNG") else "image/jpeg", True
        self.request(code)
        name = self.fallback.get(code)
        if name:
            return self.archive.read(name), "image/png" if name.lower().endswith(".png") else "image/jpeg", False
        return None

    def request(self, code):
        with self.lock:
            if code in self.pending or len(self.pending) >= 36 or self.clock() < self.retry_after.get(code, 0):
                return
            self.pending.add(code)
        self.pool.submit(self.download, code)

    def download(self, code):
        temporary = self.cache / f"{code}.tmp"
        try:
            request = Request(IMAGE_URL.format(code=code), headers={"User-Agent": "PuzzleStudio/0.2", "Accept": "image/jpeg,image/png"})
            with self.opener(request, timeout=10) as response:
                data = response.read(MAX_IMAGE_BYTES + 1)
            if len(data) > MAX_IMAGE_BYTES or not valid_picture(data):
                raise ValueError("Invalid card picture response")
            temporary.write_bytes(data)
            os.replace(temporary, self.cache / f"{code}.jpg")
        except Exception:
            with self.lock:
                self.retry_after[code] = self.clock() + 300
        finally:
            temporary.unlink(missing_ok=True)
            with self.lock:
                self.pending.discard(code)

    def close(self):
        self.pool.shutdown(wait=True, cancel_futures=True)
        if self.archive:
            self.archive.close()
