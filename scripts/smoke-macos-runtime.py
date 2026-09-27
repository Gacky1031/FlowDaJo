#!/usr/bin/env python3
"""Exercise the exact R runtime that the macOS application will launch."""

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path


runtime = Path(sys.argv[1]).resolve()
rhome = runtime / "R"
r = rhome / "bin" / "exec" / "R"
worker = runtime.parent / "r" / "worker.R"
if not worker.is_file():
    worker = Path(__file__).resolve().parents[1] / "r" / "worker.R"
core = worker.parent / "core.R"
env = {
    "PATH": "/usr/bin:/bin:/usr/sbin:/sbin",
    "HOME": os.environ.get("HOME", "/tmp"),
    "TMPDIR": os.environ.get("TMPDIR", "/tmp"),
    "LANG": "C.UTF-8", "LC_ALL": "C.UTF-8", "R_HOME": str(rhome),
    "R_LIBS": str(rhome / "library"),
    "R_LIBS_USER": str(rhome / "library"),
    "R_LIBS_SITE": str(rhome / "library"),
    "R_DEFAULT_PACKAGES": "datasets,utils,grDevices,graphics,stats,methods",
}


def run(args, payload=None):
    result = subprocess.run([str(r), "--vanilla", "--slave", "--no-echo", *args],
                            input=json.dumps(payload) + "\n" if payload else None,
                            text=True, capture_output=True, env=env, timeout=90)
    if result.returncode:
        raise RuntimeError(f"Bundled R failed ({result.returncode}): {result.stderr}\n{result.stdout}")
    return result.stdout


with tempfile.TemporaryDirectory(prefix="flowdajo-smoke-") as storage:
    def request(action, **kwargs):
        output = run([f"--file={worker}", "--args"],
                     {"action": action, "storage": storage, **kwargs})
        response = json.loads(output.strip())
        if not response["ok"]:
            raise RuntimeError(f"R {action} failed: {response['error']}")
        return response["data"]

    health = request("health")
    if (Path(health["rHome"]).resolve() != rhome
            or not Path(health["flowCorePath"]).is_relative_to(rhome)
            or any(not Path(path).is_relative_to(rhome) for path in health["libraryPaths"])):
        raise RuntimeError(f"R escaped the bundle: {health}")
    demo = request("demo")
    if demo["samples"][0]["events"] != 16000:
        raise RuntimeError("Bundled R demo returned the wrong event count")
    fcs = Path(storage) / "検証サンプル.fcs"
    expression = (f"source({json.dumps(str(core))}); "
                  f"flowCore::write.FCS(demo_frame(n=128L), {json.dumps(str(fcs))})")
    run(["-e", expression])
    imported = request("import", paths=[str(fcs)])
    if len(imported["samples"]) != 1 or imported["samples"][0]["events"] != 128:
        raise RuntimeError(f"Bundled R could not import FCS: {imported}")
    project = {"schema": "flowdesk-r/1", "name": "Bundle smoke", "samples": imported["samples"],
               "gates": [], "selectedGate": "root"}
    project_file = Path(storage) / "検証プロジェクト.json"
    request("save", path=str(project_file), project=project)
    loaded = request("load", path=str(project_file))
    if len(loaded["samples"]) != 1 or loaded["samples"][0]["events"] != 128:
        raise RuntimeError(f"Bundled R could not reopen the project: {loaded}")
    print(f"Bundled R {health['r']} / flowCore {health['flowCore']}: FCS and project import OK")
