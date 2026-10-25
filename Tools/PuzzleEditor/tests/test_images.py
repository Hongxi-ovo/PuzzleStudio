"""Offline cache, fallback and embedded-resource checks, without external requests."""
import io
from pathlib import Path
import sys
import tempfile
import threading
import unittest
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from card_images import CardPictures, image_size, valid_picture
import server


class Pictures(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.jpeg = (server.HERE / "resources/cover.jpg").read_bytes()
        with zipfile.ZipFile(self.root / "pics.zip", "w") as archive:
            archive.writestr("pics/135598.jpg", self.jpeg)
        self.entered, self.release = threading.Event(), threading.Event()
        self.calls = []
        self.instances = []

    def tearDown(self):
        self.release.set()
        for instance in self.instances:
            instance.close()
        self.temp.cleanup()

    def make(self, opener):
        pictures = CardPictures(self.root, self.root / "cache", opener=opener, clock=lambda: 10)
        self.instances.append(pictures)
        return pictures

    def blocked_download(self, request, timeout):
        self.calls.append(request.full_url)
        self.entered.set()
        self.release.wait(3)
        return io.BytesIO(self.jpeg)

    def test_fallback_is_immediate_and_duplicate_requests_share_download(self):
        pictures = self.make(self.blocked_download)
        self.assertEqual(pictures.picture(135598), (self.jpeg, "image/jpeg", False))
        self.assertTrue(self.entered.wait(1))
        for _ in range(5):
            pictures.picture(135598)
        self.assertEqual(len(self.calls), 1)
        self.assertFalse((self.root / "cache/135598.jpg").exists())
        self.release.set()
        pictures.pool.shutdown(wait=True)
        self.assertEqual(pictures.picture(135598), (self.jpeg, "image/jpeg", True))
        self.assertTrue(pictures.version(135598))
        self.assertFalse(list((self.root / "cache").glob("*.tmp")))

    def test_saved_cache_works_in_new_instance_without_network(self):
        pictures = self.make(lambda *args, **kwargs: io.BytesIO(self.jpeg))
        pictures.request(135598)
        pictures.pool.shutdown(wait=True)
        def offline(*args, **kwargs):
            self.fail("A cached picture must not access the network")
        reopened = self.make(offline)
        self.assertTrue(reopened.picture(135598)[2])

    def test_failed_response_does_not_poison_cache_and_has_retry_delay(self):
        def html(*args, **kwargs):
            self.calls.append(1)
            return io.BytesIO(b"<html>404</html>")
        pictures = self.make(html)
        pictures.request(135598)
        pictures.pool.shutdown(wait=True)
        self.assertEqual(pictures.picture(135598)[0], self.jpeg)
        self.assertEqual(len(self.calls), 1)
        self.assertFalse((self.root / "cache/135598.jpg").exists())
        self.assertFalse(pictures.version(135598))

    def test_image_headers_reject_cropped_art_and_corruption(self):
        self.assertEqual(image_size(self.jpeg), (400, 580))
        self.assertTrue(valid_picture(self.jpeg))
        self.assertFalse(valid_picture(b"\xff\xd8\xff\xc0\x00\x02\xff\xd9"))
        self.assertFalse(valid_picture(self.jpeg[:-20]))
        self.assertFalse(valid_picture(b"not an image"))


class EmbeddedData(unittest.TestCase):
    def test_empty_workspace_and_no_game_database_or_scripts_still_work(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            resources = server.Resources(root, "zh-CN", cache_dir=root / "cache")
            try:
                self.assertTrue(resources.bundled)
                self.assertGreater(len(resources.cards), 15000)
                self.assertIn(135598, resources.cards)
                self.assertIn(65741786, resources.script_sources)
                self.assertIn("INDESTRUCTABLE_EFFECT", resources.script_sources[65741786][0])
                self.assertIn(135598, resources.pictures.fallback)
                self.assertTrue(valid_picture(resources.pictures.archive.read(resources.pictures.fallback[135598])))
                self.assertFalse((root / "Data").exists())
                self.assertFalse((root / "script").exists())
            finally:
                resources.pictures.close()


if __name__ == "__main__":
    unittest.main()
