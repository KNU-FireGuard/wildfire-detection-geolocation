"""Create a source-only production bundle, without demo assets or secrets."""
import argparse
from pathlib import Path
import tarfile

ROOT = Path(__file__).resolve().parents[1]
FILES = (
    '.dockerignore', 'backend/package.json', 'backend/package-lock.json',
    'frontend/package.json', 'frontend/package-lock.json',
    'frontend/index.html', 'frontend/vite.config.js', 'sql/init.sql',
    'deploy/Dockerfile.api', 'deploy/Dockerfile.web', 'deploy/requirements.txt',
    'deploy/nginx.conf', 'deploy/cameras.json', 'deploy/compose.yml',
    'deploy/compose.gpu.yml', 'deploy/.env.example', 'deploy/README.md',
    'deploy/mock-cameras.js', 'deploy/mock-events.js',
    'ai/camera_config.py', 'ai/camera_model.py', 'ai/camera_calibration.py',
    'ai/dem_skyline_engine.py', 'ai/fire_location_estimator.py',
    'ai/location_session.py', 'ai/ridge_detector.py',
    'ai/inference/backend_connect.py', 'ai/inference/live_runner.py',
    'ai/inference/temporal_detection.py',
)


def production_files():
    files = {ROOT / name for name in FILES}
    for directory in ('backend/src', 'frontend/src', 'frontend/public'):
        for file in (ROOT / directory).rglob('*'):
            relative = file.relative_to(ROOT)
            extensions = {'.js'} if directory == 'backend/src' else {
                '.js', '.vue', '.css', '.svg', '.png', '.jpg', '.jpeg',
                '.webp', '.woff', '.woff2', '.ico',
            }
            if file.is_file() and file.suffix in extensions and 'mocks' not in relative.parts:
                files.add(file)
    for file in files:
        if not file.is_file() or file.is_symlink():
            raise ValueError(f'Missing file or unexpected symlink: {file.relative_to(ROOT)}')
        if file.suffix in ('.mp4', '.pt', '.npz', '.pyc') or file.name == '.env':
            raise ValueError(f'Forbidden file: {file.relative_to(ROOT)}')
    return sorted(files)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    # Exclusive creation prevents accidentally overwriting an existing artifact
    with args.output.open('xb') as output:
        with tarfile.open(fileobj=output, mode='w:gz') as archive:
            for file in production_files():
                archive.add(file, arcname=str(file.relative_to(ROOT)), recursive=False)
    print(f'Production source bundle created: {args.output}')


if __name__ == '__main__':
    main()
