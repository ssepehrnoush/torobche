"""Deploy Torobche to Liara through its REST API (no CLI login needed).

    python -I deploy/deploy_liara.py --check     # balance + app status, changes nothing
    python -I deploy/deploy_liara.py --create    # create the app if it does not exist (spends credit)
    python -I deploy/deploy_liara.py             # pack, upload, set envs, release, follow build logs

Secrets (LIARA_API_TOKEN, BOXAPI_KEY, KAVENEGAR_API_KEY) are read from the hackathon .env and never printed.
The real demo text and call need KAVENEGAR_API_KEY and DEMO_SHOP_PHONES there too; without them nothing is sent.
The build context is packed explicitly (not from .gitignore), so the dataset zip, which is not in
git, travels with the deploy and the image builds its own SQLite database from it.
"""
from __future__ import annotations

import argparse
import io
import json
import os
import sys
import tarfile
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent  # torob/
HACKATHON = ROOT.parent
API = "https://api.iran.liara.ir"
APP = os.environ.get("LIARA_APP", "torobche-gen")  # the Generative UI copy; never deploy it over bazargard-map
PLAN = os.environ.get("LIARA_PLAN", "small-g2")
BUNDLE = os.environ.get("LIARA_BUNDLE", "standard")  # basic allows only a 5-minute build
PORT = 8000
TEAM = os.environ.get("LIARA_TEAM_ID", "6ad4685525646e1982f75717")  # hackathon credit sits on the team

INCLUDE = [
    "Dockerfile", ".dockerignore", "liara.json",
    "backend/requirements.txt", "backend/app", "backend/scripts/make_app_db.py",
    "data/build_db.py", "frontend/dist",
]
DATASET_ZIP = HACKATHON / "_downloads" / "torob" / "dataset.zip"


def env() -> dict:
    out = {}
    for p in (HACKATHON / ".env", ROOT / ".env"):
        if p.is_file():
            for line in p.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    out.setdefault(k.strip(), v.strip())
    out.update({k: v for k, v in os.environ.items() if k in ("LIARA_API_TOKEN", "BOXAPI_KEY")})
    return out


ENV = env()
TOKEN = ENV.get("LIARA_API_TOKEN", "")


def call(method: str, path: str, body: dict | None = None, raw: bytes | None = None,
         ctype: str = "application/json", timeout: int = 60):
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    if TEAM:
        path += ("&" if "?" in path else "?") + f"teamID={TEAM}"
    req = urllib.request.Request(API + path, data=data, method=method,
                                 headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": ctype})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            txt = r.read().decode("utf-8", "replace")
            return r.status, (json.loads(txt) if txt.strip().startswith(("{", "[")) else txt)
    except urllib.error.HTTPError as e:
        txt = e.read().decode("utf-8", "replace")
        try:
            return e.code, json.loads(txt)
        except ValueError:
            return e.code, txt[:500]


def balance() -> float | None:
    st, b = call("GET", "/v1/me")
    if st == 200 and isinstance(b, dict):
        owner = b.get("team") or b.get("user") or {}
        return float(owner.get("balance", 0))
    return None


def app_status() -> dict | None:
    st, d = call("GET", f"/v1/projects/{APP}")
    return d.get("project") if st == 200 and isinstance(d, dict) else None


def pack() -> bytes:
    if not (ROOT / "frontend" / "dist" / "index.html").is_file():
        sys.exit("frontend/dist missing: run `npm --prefix frontend run build` first")
    if not DATASET_ZIP.is_file():
        sys.exit(f"dataset zip not found at {DATASET_ZIP}")
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz", compresslevel=6) as tar:
        def skip(ti: tarfile.TarInfo):
            return None if "__pycache__" in ti.name or ti.name.endswith(".pyc") else ti
        for rel in INCLUDE:
            tar.add(ROOT / rel, arcname=rel, filter=skip)
        tar.add(DATASET_ZIP, arcname="deploy/dataset.zip")
    return buf.getvalue()


def multipart(field: str, filename: str, payload: bytes) -> tuple[bytes, str]:
    boundary = uuid.uuid4().hex
    head = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"{field}\"; filename=\"{filename}\"\r\n"
            f"Content-Type: application/gzip\r\n\r\n").encode()
    return head + payload + f"\r\n--{boundary}--\r\n".encode(), f"multipart/form-data; boundary={boundary}"


def set_envs() -> None:
    variables = [
        {"key": "LLM_PROVIDER", "value": "boxapi"},
        {"key": "LLM_FALLBACK_PROVIDER", "value": "none"},
        {"key": "BOXAPI_KEY", "value": ENV.get("BOXAPI_KEY", "")},
    ]
    if os.environ.get("BOXAPI_MODEL"):
        variables.append({"key": "BOXAPI_MODEL", "value": os.environ["BOXAPI_MODEL"]})
    for k in ("KAVENEGAR_API_KEY", "DEMO_SHOP_PHONES", "KAVENEGAR_TEMPLATE", "WAHA_URL", "WAHA_API_KEY"):
        if ENV.get(k):
            variables.append({"key": k, "value": ENV[k]})
    st, d = call("POST", "/v1/projects/update-envs", {"project": APP, "variables": variables})
    print("envs:", st, (d.get("message") if isinstance(d, dict) else "")[:120] if st != 200 else "ok")


def follow(release_id: str) -> None:
    since = 0
    t0 = time.time()
    while time.time() - t0 < 1500:
        st, logs = call("GET", f"/v2/releases/{release_id}/build-logs?since={since}")
        if st == 200 and isinstance(logs, list):
            for entry in logs:
                line = entry.get("line") if isinstance(entry, dict) else str(entry)
                if line:
                    print("  |", line.rstrip()[:300])
                if isinstance(entry, dict) and entry.get("createdAt"):
                    since = max(since, int(time.mktime(time.strptime(entry["createdAt"][:19], "%Y-%m-%dT%H:%M:%S"))) * 1000)
        st, rel = call("GET", f"/v1/projects/{APP}/releases")
        cur = None
        if st == 200 and isinstance(rel, dict):
            for r in rel.get("releases", []):
                if r.get("_id") == release_id:
                    cur = r
        state = (cur or {}).get("state") or (cur or {}).get("status")
        if state in ("READY", "DEPLOYED", "SUCCEEDED", "FAILED", "CANCELED", "ERROR"):
            print("release state:", state)
            return
        time.sleep(6)
    print("stopped following after 25 minutes; check the Liara console")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--create", action="store_true")
    ap.add_argument("--follow", help="only follow the build logs of this release id")
    ap.add_argument("--llm-off", action="store_true", help="kill switch: LLM_DISABLED=1 (app keeps working rule-based)")
    ap.add_argument("--llm-on", action="store_true")
    ap.add_argument("--scale", type=int, help="0 stops the app, 1 starts it again")
    a = ap.parse_args()
    if a.follow:
        follow(a.follow)
        return
    if a.llm_off or a.llm_on:
        st, d = call("POST", "/v1/projects/update-envs", {"project": APP, "variables": [
            {"key": "LLM_DISABLED", "value": "1" if a.llm_off else "0"}]})
        print("LLM_DISABLED =", "1" if a.llm_off else "0", "->", st)
        return
    if a.scale is not None:
        st, d = call("POST", f"/v1/projects/{APP}/actions/scale", {"scale": a.scale})
        print("scale", a.scale, "->", st)
        return
    if not TOKEN:
        sys.exit("LIARA_API_TOKEN missing")
    bal = balance()
    proj = app_status()
    print(f"balance: {bal} toman | app '{APP}': {'exists, status=' + str(proj.get('status')) if proj else 'missing'}")
    if a.check:
        return
    if not proj:
        if not a.create:
            sys.exit("app does not exist; run with --create (this starts hourly billing)")
        body = {"name": APP, "planID": PLAN, "platform": "docker", "bundlePlanID": BUNDLE,
                "readOnlyRootFilesystem": False}
        st, nets = call("GET", "/v1/networks")  # g2 plans need a private network
        if st == 200 and isinstance(nets, dict) and nets.get("networks"):
            body["network"] = nets["networks"][0]["_id"]
        st, d = call("POST", "/v1/projects", body)
        print("create:", st, d if st != 200 else "ok")
        if st not in (200, 201):
            sys.exit(1)
    set_envs()
    blob = pack()
    print(f"source: {len(blob) / 1048576:.1f} MB")
    body, ctype = multipart("file", "source.tar.gz", blob)
    st, d = call("POST", f"/v2/projects/{APP}/sources", raw=body, ctype=ctype, timeout=900)
    if st not in (200, 201) or not isinstance(d, dict) or not d.get("sourceID"):
        sys.exit(f"upload failed: {st} {str(d)[:300]}")
    st, d = call("POST", f"/v2/projects/{APP}/releases", {"sourceID": d["sourceID"], "port": PORT, "type": "docker"})
    if st not in (200, 201) or not isinstance(d, dict) or not d.get("releaseID"):
        sys.exit(f"release failed: {st} {str(d)[:300]}")
    print("release:", d["releaseID"])
    follow(d["releaseID"])
    print(f"url: https://{APP}.liara.run")


if __name__ == "__main__":
    main()
