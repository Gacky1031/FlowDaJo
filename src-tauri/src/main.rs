#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod worker;
mod pdf;
mod preview;
use serde_json::Value;
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::path::PathBuf;
#[cfg(windows)]
use std::process::{Command, Stdio};
use tauri::Manager;

fn runtime_root() -> Result<PathBuf, String> {
    if cfg!(debug_assertions) {
        return Ok(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("runtime"));
    }
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    #[cfg(target_os = "macos")]
    return Ok(exe
        .parent()
        .and_then(|dir| dir.parent())
        .ok_or("Cannot locate the macOS application bundle")?
        .join("Resources/runtime"));
    #[cfg(not(target_os = "macos"))]
    Ok(exe
        .parent()
        .ok_or("Cannot locate the application folder")?
        .join("runtime"))
}

fn rscript(root: &std::path::Path) -> Result<PathBuf, String> {
    let path = root.join(if cfg!(windows) {
        "R/bin/Rscript.exe"
    } else if cfg!(target_os = "macos") {
        "R/bin/exec/R"
    } else {
        "R/bin/Rscript"
    });
    if !path.is_file() || !root.join("R/library/flowCore/DESCRIPTION").is_file() {
        return Err("Bundled R is missing. Extract the entire application ZIP, including the runtime folder, or reinstall FlowDaJo.".into());
    }
    Ok(path)
}

fn run_r(script: PathBuf, storage: PathBuf, payload: Value) -> Result<Value, String> {
    worker::call(script, storage, payload)
}

#[tauri::command]
async fn request(app: tauri::AppHandle, payload: Value) -> Result<Value, String> {
    let script = if cfg!(debug_assertions) {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../r/worker.R")
    } else {
        app.path()
            .resource_dir()
            .map_err(|e| e.to_string())?
            .join("r/worker.R")
    };
    let storage = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("frames");
    tauri::async_runtime::spawn_blocking(move || run_r(script, storage, payload))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn prepare_pdf_preview(app: tauri::AppHandle, payload: Value) -> Result<Value, String> {
    let script = if cfg!(debug_assertions) {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../r/worker.R")
    } else {
        app.path().resource_dir().map_err(|e| e.to_string())?.join("r/worker.R")
    };
    let cache = app.path().app_cache_dir().map_err(|e| e.to_string())?;
    let storage = cache.join("frames");
    tauri::async_runtime::spawn_blocking(move || preview::prepare(script, storage, cache, payload))
        .await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn commit_pdf_preview(preview_id: String, path: String) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || preview::commit(&preview_id, &PathBuf::from(path)))
        .await.map_err(|e| e.to_string())?
}

#[tauri::command]
fn release_pdf_preview(preview_id: String) -> Result<(), String> {
    preview::release(&preview_id)
}

fn main() {
    #[cfg(windows)]
    {
        // Windows uses a fixed WebView2 runtime. macOS uses the system WebKit.
        let webview = runtime_root()
            .expect("Cannot locate bundled runtime")
            .join("WebView2");
        if !webview.join("msedgewebview2.exe").is_file() {
            eprintln!("Bundled WebView2 is missing. Extract the entire application package.");
            std::process::exit(1);
        }
        std::env::set_var("WEBVIEW2_BROWSER_EXECUTABLE_FOLDER", &webview);
        let windows = PathBuf::from(std::env::var_os("SystemRoot").unwrap_or("C:\\Windows".into()));
        let _ = Command::new(windows.join("System32/icacls.exe"))
            .arg(&webview)
            .args(["/grant", "*S-1-15-2-2:(OI)(CI)(RX)", "*S-1-15-2-1:(OI)(CI)(RX)", "/Q"])
            .creation_flags(0x08000000)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![request, prepare_pdf_preview, commit_pdf_preview, release_pdf_preview])
        .build(tauri::generate_context!())
        .expect("Failed to run FlowDaJo")
        .run(|_, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                worker::shutdown();
                preview::shutdown();
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;
    fn call(payload: Value) -> Result<Value, String> {
        run_r(
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../r/worker.R"),
            std::env::temp_dir().join(format!("flowdesk-rust-test-{}", std::process::id())),
            payload,
        )
    }
    #[test]
    fn actual_r_health() {
        let result = call(serde_json::json!({"action":"health"})).unwrap();
        assert_eq!(result["engine"], "R / flowCore");
    }
    #[test]
    fn only_allowed_actions() {
        assert!(call(serde_json::json!({"action":"eval"}))
            .unwrap_err()
            .contains("Unsupported"));
    }
    #[test]
    fn missing_bundle_never_falls_back_to_system_r() {
        assert!(rscript(&std::env::temp_dir().join("flowdesk-no-runtime")).is_err());
    }
    #[test]
    fn actual_r_analysis_roundtrip() {
        let demo = call(serde_json::json!({"action":"demo"})).unwrap();
        let result = call(serde_json::json!({"action":"analyze","sampleId":"demo-42","project":{
            "schema":"flowdesk-r/1","name":"Rust integration","samples":demo["samples"],"gates":[],"selectedGate":"root"
        }})).unwrap();
        assert_eq!(result["stats"][0]["count"], 16000);
        assert_eq!(result["plots"].as_array().unwrap().len(), 4);
    }
    #[test]
    fn persistent_worker_keeps_pid_after_domain_error() {
        let a = call(serde_json::json!({"action":"health"})).unwrap();
        assert!(call(serde_json::json!({"action":"analyze","sampleId":"missing","project":{"schema":"flowdesk-r/1","samples":[],"gates":[]}})).is_err());
        let b = call(serde_json::json!({"action":"health"})).unwrap();
        assert_eq!(a["workerPid"], b["workerPid"]);
    }
    #[test]
    fn worksheet_pdf_merges_landscape_and_portrait_from_r() {
        let demo = call(serde_json::json!({"action":"demo"})).unwrap();
        let path = std::env::temp_dir().join(format!("flowdesk-a4-{}.pdf", std::process::id()));
        let axis_x = serde_json::json!({"channel":"FSC-A","scale":"linear","w":0.5,"t":262144,"m":4.5,"a":0});
        let axis_y = serde_json::json!({"channel":"SSC-A","scale":"linear","w":0.5,"t":262144,"m":4.5,"a":0});
        let response = call(serde_json::json!({
            "action":"worksheet_pdf",
            "path":path,
            "sampleId":"demo-42",
            "project":{"schema":"flowdesk-r/1","name":"A4 integration","samples":demo["samples"],"gates":[],"selectedGate":"root"},
            "plots":[{"id":"first","sampleId":"active","population":[],"mode":"scatter","x":axis_x,"y":axis_y,"left":24,"top":24,"width":344,"height":314}],
            "widgets":[],
            "includeWidgets":false,
            "printPages":[{"left":0,"top":0,"orientation":"landscape"},{"left":1200,"top":0,"orientation":"portrait"}]
        })).unwrap();
        assert_eq!(response["pages"], 2);
        let document = lopdf::Document::load(&path).unwrap();
        assert_eq!(document.get_pages().len(), 2);
        let _ = std::fs::remove_file(path);
    }
}
