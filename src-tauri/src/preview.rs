use serde_json::{json, Value};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{atomic::{AtomicU64, Ordering}, Mutex, OnceLock},
    time::{SystemTime, UNIX_EPOCH},
};

struct Prepared {
    path: PathBuf,
    report: Value,
}

static PREVIEWS: OnceLock<Mutex<HashMap<String, Prepared>>> = OnceLock::new();
static NEXT_ID: AtomicU64 = AtomicU64::new(0);
fn previews() -> &'static Mutex<HashMap<String, Prepared>> {
    PREVIEWS.get_or_init(|| Mutex::new(HashMap::new()))
}

pub fn prepare(script: PathBuf, storage: PathBuf, cache: PathBuf, mut payload: Value) -> Result<Value, String> {
    let action = payload.get("action").and_then(Value::as_str).ok_or("Missing PDF action")?;
    if action != "worksheet_pdf" && action != "worksheet_report_pdf" {
        return Err("Preview accepts worksheet PDFs only".into());
    }
    let directory = cache.join("previews");
    std::fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    let now = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|e| e.to_string())?.as_nanos();
    let id = format!("{}-{now}-{}", std::process::id(), NEXT_ID.fetch_add(1, Ordering::Relaxed));
    let path = directory.join(format!("{id}.pdf"));
    payload["path"] = path.to_string_lossy().into_owned().into();
    let report = match super::worker::call(script, storage, payload) {
        Ok(value) => value,
        Err(error) => { let _ = std::fs::remove_file(&path); return Err(error); }
    };
    let document = lopdf::Document::load(&path).map_err(|error| {
        let _ = std::fs::remove_file(&path);
        format!("Preview PDF is invalid: {error}")
    })?;
    if document.get_pages().is_empty() {
        let _ = std::fs::remove_file(&path);
        return Err("Preview PDF has no pages".into());
    }
    previews().lock().map_err(|_| "Preview lock failed")?.insert(id.clone(), Prepared { path: path.clone(), report: report.clone() });
    Ok(json!({ "previewId": id, "path": path, "result": report }))
}

fn copy_exact(source: &Path, target: &Path) -> Result<(), String> {
    if !source.is_file() { return Err("Preview PDF has expired".into()); }
    if source == target { return Err("Choose a different PDF output path".into()); }
    let temporary = target.with_extension(format!("flowdesk-{}.tmp", std::process::id()));
    std::fs::copy(source, &temporary).map_err(|e| e.to_string())?;
    let backup = target.with_extension(format!("flowdesk-{}-backup.tmp", std::process::id()));
    let result = (|| {
        let had_target = target.exists();
        if had_target {
            if backup.exists() { return Err("A previous PDF save is still in progress".into()); }
            std::fs::rename(target, &backup).map_err(|e| e.to_string())?;
        }
        match std::fs::rename(&temporary, target) {
            Ok(()) => {
                if had_target { let _ = std::fs::remove_file(&backup); }
                Ok(())
            }
            Err(error) => {
                if had_target { let _ = std::fs::rename(&backup, target); }
                Err(error.to_string())
            }
        }
    })();
    let _ = std::fs::remove_file(&temporary);
    result
}

pub fn commit(id: &str, target: &Path) -> Result<Value, String> {
    let mut guard = previews().lock().map_err(|_| "Preview lock failed")?;
    let prepared = guard.get(id).ok_or("Preview PDF has expired")?;
    copy_exact(&prepared.path, target)?;
    let report = prepared.report.clone();
    let path = prepared.path.clone();
    guard.remove(id);
    let _ = std::fs::remove_file(path);
    Ok(report)
}

pub fn release(id: &str) -> Result<(), String> {
    if let Some(prepared) = previews().lock().map_err(|_| "Preview lock failed")?.remove(id) {
        let _ = std::fs::remove_file(prepared.path);
    }
    Ok(())
}

pub fn shutdown() {
    if let Ok(mut guard) = previews().lock() {
        for (_, prepared) in guard.drain() { let _ = std::fs::remove_file(prepared.path); }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn copies_identical_bytes() {
        let dir = std::env::temp_dir().join(format!("flowdesk-exact-preview-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let source = dir.join("preview.pdf");
        let target = dir.join("saved.pdf");
        std::fs::write(&source, b"%PDF-1.5\nfixed-preview-bytes").unwrap();
        copy_exact(&source, &target).unwrap();
        assert_eq!(std::fs::read(&source).unwrap(), std::fs::read(&target).unwrap());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn generated_preview_is_the_saved_pdf() {
        let root = std::env::temp_dir().join(format!("flowdesk-preview-roundtrip-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        let script = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../r/worker.R");
        let storage = root.join("frames");
        let demo = super::super::worker::call(script.clone(), storage.clone(), json!({ "action": "demo" })).unwrap();
        let project = json!({
            "schema":"flowdesk-r/1", "name":"Exact preview", "samples":demo["samples"],
            "gates":[], "selectedGate":"root"
        });
        let x = json!({"channel":"FSC-A","scale":"linear","w":0.5,"t":262144,"m":4.5,"a":0});
        let y = json!({"channel":"SSC-A","scale":"linear","w":0.5,"t":262144,"m":4.5,"a":0});
        let prepared = prepare(script, storage, root.clone(), json!({
            "action":"worksheet_pdf", "project":project, "sampleId":"demo-42",
            "plots":[{"id":"p","sampleId":"active","population":[],"mode":"scatter",
                "x":x,"y":y,"left":24,"top":24,"width":344,"height":314}],
            "widgets":[], "printPages":[
                {"left":0,"top":0,"orientation":"landscape"},
                {"left":1200,"top":0,"orientation":"portrait"}
            ]
        })).unwrap();
        let preview_path = PathBuf::from(prepared["path"].as_str().unwrap());
        let before = std::fs::read(&preview_path).unwrap();
        assert_eq!(prepared["result"]["pages"], 2);
        let output = root.join("saved.pdf");
        let id = prepared["previewId"].as_str().unwrap();
        let report = commit(id, &output).unwrap();
        assert_eq!(report["pages"], 2);
        assert_eq!(before, std::fs::read(&output).unwrap());
        assert!(!preview_path.exists());
        let _ = std::fs::remove_dir_all(root);
    }
}
