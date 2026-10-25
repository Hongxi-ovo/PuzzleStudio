"""Check portable resource discovery independently of the development checkout."""
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch
from types import SimpleNamespace
import json

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import desktop


class DesktopPaths(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="puzzle-portable-")
        self.root = Path(self.temp.name).resolve()
        self.game = self.make_game("game")

    def tearDown(self):
        self.temp.cleanup()

    def make_game(self, name):
        game = self.root / name
        database = game / "Data/locales/zh-CN/cards.cdb"
        database.parent.mkdir(parents=True)
        database.touch()
        return game

    def test_exe_in_game_subfolder_finds_game_without_hardcoded_path(self):
        executable = self.game / "Tools/Editor/PuzzleStudio.exe"
        self.assertEqual(desktop.find_root(executable=executable, cwd=self.root), self.game)

    def test_nearby_resources_take_precedence_over_previous_installation(self):
        previous = self.make_game("previous")
        self.assertEqual(desktop.find_root(settings={"root": str(previous)},
                                          executable=self.game / "PuzzleStudio.exe", cwd=self.root), self.game)

    def test_saved_root_works_after_moving_exe_elsewhere(self):
        self.assertEqual(desktop.find_root(settings={"root": str(self.game)},
                                          executable=self.root / "standalone/PuzzleStudio.exe", cwd=self.root), self.game)

    def test_invalid_explicit_root_is_not_silently_replaced(self):
        with self.assertRaises(ValueError):
            desktop.find_root(explicit=self.root / "missing", executable=self.game / "PuzzleStudio.exe")

    def test_no_resources_returns_selection_request(self):
        self.assertIsNone(desktop.find_root(executable=self.root / "standalone/PuzzleStudio.exe", cwd=self.root))


class ProjectSave(unittest.TestCase):
    def setUp(self):
        self.files = desktop.ProjectFiles()
        self.files._window = Mock()
        self.content = json.dumps({"schemaVersion": 1, "cards": [], "title": "保存测试"}, ensure_ascii=False)
        self.webview = patch.dict(sys.modules, {"webview": SimpleNamespace(FileDialog=SimpleNamespace(SAVE=20))})
        self.webview.start()

    def tearDown(self):
        self.webview.stop()

    def test_save_cancel_preserves_project(self):
        self.files._window.create_file_dialog.return_value = None
        self.assertEqual(self.files.save_project(self.content, "保存测试.puzzle.json"), {"saved": False})

    def test_save_writes_exact_content_and_replaces_existing_file(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "保存 工程.puzzle.json"
            path.write_text("old", encoding="utf-8")
            self.files._window.create_file_dialog.return_value = (str(path),)
            self.assertTrue(self.files.save_project(self.content, "保存测试.puzzle.json")["saved"])
            self.assertEqual(path.read_text(encoding="utf-8"), self.content)
            self.assertEqual(list(Path(folder).iterdir()), [path])

    def test_write_failure_keeps_previous_file(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "project.json"
            path.write_text("previous", encoding="utf-8")
            self.files._window.create_file_dialog.return_value = [str(path)]
            with patch.object(desktop.os, "replace", side_effect=OSError("write failed")), self.assertLogs(level="ERROR"):
                result = self.files.save_project(self.content, "project.json")
            self.assertFalse(result["saved"])
            self.assertEqual(path.read_text(encoding="utf-8"), "previous")
            self.assertEqual(list(Path(folder).iterdir()), [path])


if __name__ == "__main__":
    unittest.main()
