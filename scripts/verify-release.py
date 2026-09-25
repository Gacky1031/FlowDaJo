"""Verify the portable ZIP against its staging directory and emit SHA-256 records."""
import hashlib, json, sys, zipfile
from pathlib import Path
version = sys.argv[1] if len(sys.argv)>1 else "0.4.0"
root=Path(__file__).resolve().parent.parent
folder=Path(sys.argv[2]).resolve() if len(sys.argv)>2 else root/"release"/f"FlowDesk-Tauri-{version}"
archive=Path(sys.argv[3]).resolve() if len(sys.argv)>3 else root/"release"/f"FlowDesk-Tauri-{version}-windows-x64-bundled.zip"
def sha(path):
    h=hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda:f.read(1024*1024),b""):h.update(chunk)
    return h.hexdigest().upper()
expected={folder.name+"/"+p.relative_to(folder).as_posix():p for p in folder.rglob("*") if p.is_file()}
with zipfile.ZipFile(archive) as z:
    entries={i.filename.replace(chr(92),"/"):i for i in z.infolist() if not i.is_dir()}
    assert entries.keys()==expected.keys(),"ZIP file inventory mismatch"
    for name,p in expected.items():assert entries[name].file_size==p.stat().st_size,name
    critical=["FlowDesk-Tauri.exe","r/core.R","r/worker.R","r/worksheet.R","r/diva.R","runtime/R/bin/Rscript.exe","runtime/WebView2/msedgewebview2.exe","README.md","docs/VALIDATION-"+version+".md","runtime/THIRD-PARTY-NOTICES.md"]
    for item in critical:
        key=folder.name+"/"+item
        assert hashlib.sha256(z.read(entries[key])).hexdigest().upper()==sha(folder/item),item
setup=root/"release"/f"FlowDesk Tauri_{version}_x64-setup.exe"
records=[{"file":p.name,"bytes":p.stat().st_size,"sha256":sha(p)} for p in [archive,setup]]
(root/"release"/f"SHA256SUMS-{version}.txt").write_text("\n".join(r["sha256"]+"  "+r["file"] for r in records)+"\n",encoding="utf-8")
result={"version":version,"files":len(expected),"criticalHashes":len(critical),"artifacts":records}
(root/"artifacts"/f"release-{version}-validation.json").write_text(json.dumps(result,indent=2),encoding="utf-8")
print(json.dumps(result,indent=2))
