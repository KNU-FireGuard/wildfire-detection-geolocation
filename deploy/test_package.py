import importlib.util
import json
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('deployment_package', Path(__file__).with_name('package.py'))
package = importlib.util.module_from_spec(spec)
spec.loader.exec_module(package)


class ProductionPackageTest(unittest.TestCase):
    def test_production_bundle_excludes_demo_assets_secrets_and_seed(self):
        names = {str(file.relative_to(package.ROOT)) for file in package.production_files()}
        self.assertIn('sql/init.sql', names)
        self.assertIn('deploy/compose.gpu.yml', names)
        self.assertIn('deploy/cameras.json', names)
        self.assertNotIn('sql/seed.dev.sql', names)
        self.assertNotIn('deploy/compose.demo.yml', names)
        self.assertNotIn('ai/config/cameras.json', names)
        for name in names:
            self.assertFalse(name.startswith(('data/', '.git/', 'frontend/src/mocks/')), name)
            self.assertNotEqual(Path(name).name, '.env')
            self.assertNotEqual(Path(name).name, '.DS_Store')
            self.assertNotIn(Path(name).suffix, ('.pt', '.mp4', '.npz', '.pyc'))
        schema = (package.ROOT / 'sql/init.sql').read_text()
        self.assertNotRegex(schema, r'(?i)\bINSERT\s+INTO\b')
        config = json.loads((package.ROOT / 'deploy/cameras.json').read_text())
        self.assertEqual(config['cameras'], [])


if __name__ == '__main__':
    unittest.main()
