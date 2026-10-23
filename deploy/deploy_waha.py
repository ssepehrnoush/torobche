"""Deploy the WhatsApp gateway (WAHA, deploy/waha/Dockerfile) as its own Liara app, next to the main app.

⚠️ Tried 2026-10-22 and it cannot work there: WhatsApp is filtered inside Liara's Iranian data centre
(web.whatsapp.com resolves to a 10.x filter address), so the app was scaled to 0. The live gateway is
deploy/wa-gateway on countv behind wa.lemonai.ir, and WAHA_URL in the hackathon .env points there.

    python -I deploy/deploy_waha.py --check   # app status, changes nothing
    python -I deploy/deploy_waha.py --create  # create the app (starts hourly billing) and deploy
    python -I deploy/deploy_waha.py           # redeploy (a redeploy without a disk means linking WhatsApp again)
    python -I deploy/deploy_waha.py --scale 0 # stop it

WAHA_API_KEY is made once and kept in the hackathon .env, next to WAHA_URL, so the main app's deploy
passes both on; neither is ever printed. The dashboard and Swagger stay off: only the API, behind the key.
"""
from __future__ import annotations

import argparse
import io
import secrets
import sys
import tarfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import deploy_liara as L  # noqa: E402  (reuses its Liara API calls, pointed at this app)

APP = "torobche-waha"
PORT = 3000
L.APP = APP
ENV_FILE = L.HACKATHON / ".env"


def api_key() -> str:
    """The gateway's key: read from the hackathon .env, or made and appended there the first time."""
    key = L.ENV.get("WAHA_API_KEY")
    if not key:
        key = secrets.token_hex(24)
        text = ENV_FILE.read_text(encoding="utf-8")
        ENV_FILE.write_text(text + ("" if text.endswith("\n") else "\n")
                            + f"WAHA_API_KEY={key}\nWAHA_URL=https://{APP}.liara.run\n", encoding="utf-8")
        L.ENV["WAHA_API_KEY"] = key
    return key


def set_envs() -> None:
    variables = [
        {"key": "WHATSAPP_DEFAULT_ENGINE", "value": "GOWS"},
        {"key": "WHATSAPP_API_PORT", "value": str(PORT)},
        {"key": "WHATSAPP_API_HOSTNAME", "value": "0.0.0.0"},
        {"key": "WAHA_API_KEY", "value": api_key()},
        {"key": "WAHA_DASHBOARD_ENABLED", "value": "False"},
        {"key": "WHATSAPP_SWAGGER_ENABLED", "value": "False"},
        {"key": "WAHA_PRINT_QR", "value": "False"},
    ]
    st, d = L.update_envs(variables)  # merges: update-envs alone replaces the whole list
    print("envs:", st, "ok" if st in (200, 201) else str(d)[:200])


def pack() -> bytes:
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        tar.add(Path(__file__).resolve().parent / "waha" / "Dockerfile", arcname="Dockerfile")
    return buf.getvalue()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--create", action="store_true")
    ap.add_argument("--scale", type=int)
    a = ap.parse_args()
    if a.scale is not None:
        st, _ = L.call("POST", f"/v1/projects/{APP}/actions/scale", {"scale": a.scale})
        print("scale", a.scale, "->", st)
        return
    proj = L.app_status()
    print(f"balance: {L.balance()} toman | app '{APP}': {'exists, status=' + str(proj.get('status')) if proj else 'missing'}")
    if a.check:
        return
    if not proj:
        if not a.create:
            sys.exit("app does not exist; run with --create (this starts hourly billing)")
        body = {"name": APP, "planID": L.PLAN, "platform": "docker", "bundlePlanID": L.BUNDLE, "readOnlyRootFilesystem": False}
        st, nets = L.call("GET", "/v1/networks")
        if st == 200 and isinstance(nets, dict) and nets.get("networks"):
            body["network"] = nets["networks"][0]["_id"]
        st, d = L.call("POST", "/v1/projects", body)
        print("create:", st, "ok" if st in (200, 201) else d)
        if st not in (200, 201):
            sys.exit(1)
    set_envs()
    body, ctype = L.multipart("file", "source.tar.gz", pack())
    st, d = L.call("POST", f"/v2/projects/{APP}/sources", raw=body, ctype=ctype, timeout=300)
    if st not in (200, 201) or not isinstance(d, dict) or not d.get("sourceID"):
        sys.exit(f"upload failed: {st} {str(d)[:300]}")
    st, d = L.call("POST", f"/v2/projects/{APP}/releases", {"sourceID": d["sourceID"], "port": PORT, "type": "docker"})
    if st not in (200, 201) or not isinstance(d, dict) or not d.get("releaseID"):
        sys.exit(f"release failed: {st} {str(d)[:300]}")
    print("release:", d["releaseID"])
    L.follow(d["releaseID"])
    print(f"url: https://{APP}.liara.run")


if __name__ == "__main__":
    main()
