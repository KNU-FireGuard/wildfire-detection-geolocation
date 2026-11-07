"""
DEM 다운로드 SSL 인증서 처리 테스트 (#68)

- macOS python.org Python은 시스템 인증서를 쓰지 못해 urllib HTTPS가 CERTIFICATE_VERIFY_FAILED로 실패
- 네트워크 없이 urlopen을 가짜로 바꿔 인증서 사용과 오류 메시지를 검증
"""
import ssl
import sys
import tempfile
import unittest
import urllib.error
from pathlib import Path
from unittest import mock

import ai.dem_skyline_engine as eng

CAM_LAT, CAM_LON = 36.5, 128.5  # 저장소 캐시가 없는 좌표


class _Recorder:
    """urlopen 호출의 context 인자를 기록하고 지정한 예외를 냄"""

    def __init__(self, error):
        self.error = error
        self.contexts = []

    def __call__(self, req, timeout=None, context=None):
        self.contexts.append(context)
        raise self.error


def _cert_error():
    return urllib.error.URLError(ssl.SSLCertVerificationError(1, "[SSL: CERTIFICATE_VERIFY_FAILED] certificate verify failed"))


class TestSslContext(unittest.TestCase):
    def test_downloads_use_certifi_bundle(self):
        import certifi

        rec = _Recorder(urllib.error.URLError("offline"))
        with mock.patch.object(eng.urllib.request, "urlopen", rec):
            self.assertIsNone(eng.fetch_open_meteo_batch([CAM_LAT], [CAM_LON]))
            with tempfile.TemporaryDirectory() as tmp:
                self.assertIsNone(eng.fetch_terrarium_dem_grid(
                    eng.np.array([[CAM_LAT]]), eng.np.array([[CAM_LON]]), cache_dir=tmp))
        self.assertEqual(len(rec.contexts), 2)
        for ctx in rec.contexts:
            self.assertIsInstance(ctx, ssl.SSLContext)
            # certifi 묶음의 루트 인증서가 들어 있어야 함 (시스템 인증서가 없어도 검증 가능)
            self.assertGreater(len(ctx.get_ca_certs()), 0)
        self.assertTrue(Path(certifi.where()).is_file())

    def test_without_certifi_falls_back_to_system_default(self):
        with mock.patch.dict(sys.modules, {"certifi": None}):
            self.assertIsNone(eng._ssl_context())


class TestDownloadErrorMessage(unittest.TestCase):
    def _build(self, error):
        tmp = tempfile.mkdtemp()
        grid = lambda la, lo, zoom=12: eng.fetch_terrarium_dem_grid(la, lo, zoom=zoom, cache_dir=Path(tmp) / "tiles")
        with mock.patch.object(eng.urllib.request, "urlopen", _Recorder(error)):
            with self.assertRaises(RuntimeError) as cm:
                eng.build_and_cache_dem(CAM_LAT, CAM_LON, npz_path=Path(tmp) / "dem.npz", grid_source=grid)
        return str(cm.exception)

    def test_certificate_error_names_cause_and_fix(self):
        msg = self._build(_cert_error())
        self.assertIn("SSL 인증서", msg)
        self.assertIn("Install Certificates.command", msg)

    def test_network_error_keeps_network_message(self):
        msg = self._build(urllib.error.URLError("timed out"))
        self.assertIn("네트워크", msg)
        self.assertNotIn("SSL 인증서", msg)


if __name__ == "__main__":
    unittest.main()
