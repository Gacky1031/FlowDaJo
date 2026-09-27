use serde_json::Value;
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::{
    io::{BufRead, BufReader, Write},
    path::PathBuf,
    process::{Child, ChildStdin, Command, Stdio},
    sync::{
        mpsc::{self, Receiver},
        Mutex, OnceLock,
    },
    time::Duration,
};
struct Worker {
    child: Child,
    input: ChildStdin,
    output: Receiver<Result<String, String>>,
    script: PathBuf,
}
impl Drop for Worker {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}
static WORKER: OnceLock<Mutex<Option<Worker>>> = OnceLock::new();
fn state() -> &'static Mutex<Option<Worker>> {
    WORKER.get_or_init(|| Mutex::new(None))
}
impl Worker {
    fn start(script: PathBuf) -> Result<Self, String> {
        let runtime = super::runtime_root()?;
        let rhome = runtime.join("R");
        let library = rhome.join("library");
        let mut path_parts = vec![rhome.join("bin")];
        #[cfg(windows)]
        {
            let windows = PathBuf::from(std::env::var_os("SystemRoot").unwrap_or("C:\\Windows".into()));
            path_parts.insert(0, rhome.join("bin/x64"));
            path_parts.push(windows.join("System32"));
            path_parts.push(windows);
        }
        if let Some(existing) = std::env::var_os("PATH") {
            path_parts.extend(std::env::split_paths(&existing));
        }
        let path = std::env::join_paths(path_parts).map_err(|e| e.to_string())?;
        let mut command = Command::new(super::rscript(&runtime)?);
        #[cfg(target_os = "macos")]
        let locale = "C.UTF-8";
        #[cfg(not(target_os = "macos"))]
        let locale = "C";
        command.arg("--vanilla");
        #[cfg(target_os = "macos")]
        command
            .args(["--slave", "--no-echo"])
            .arg(format!("--file={}", script.display()))
            .args(["--args", "--persistent"]);
        #[cfg(not(target_os = "macos"))]
        command.arg(&script).arg("--persistent");
        command
            .env("R_HOME", &rhome)
            .env("R_LIBS", &library)
            .env("R_LIBS_USER", &library)
            .env("R_LIBS_SITE", &library)
            .env(
                "R_DEFAULT_PACKAGES",
                "datasets,utils,grDevices,graphics,stats,methods",
            )
            .env("LANG", locale)
            .env("LC_ALL", locale)
            .env("PATH", path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        #[cfg(windows)]
        command.creation_flags(0x08000000);
        let mut child = command
            .spawn()
            .map_err(|e| format!("Cannot start bundled R: {e}"))?;
        let input = child.stdin.take().ok_or("R stdin unavailable")?;
        let stdout = child.stdout.take().ok_or("R stdout unavailable")?;
        let stderr = child.stderr.take().ok_or("R stderr unavailable")?;
        let (tx, output) = mpsc::channel();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines() {
                if tx.send(line.map_err(|e| e.to_string())).is_err() {
                    break;
                }
            }
        });
        std::thread::spawn(move || {
            for line in BufReader::new(stderr).lines() {
                if line.is_err() {
                    break;
                }
            }
        });
        Ok(Self {
            child,
            input,
            output,
            script,
        })
    }
}
pub fn shutdown() {
    if let Ok(mut guard) = state().lock() {
        *guard = None;
    }
}
pub fn call(script: PathBuf, storage: PathBuf, mut payload: Value) -> Result<Value, String> {
    let action = payload
        .get("action")
        .and_then(Value::as_str)
        .ok_or("Missing action")?;
    if ![
        "health",
        "demo",
        "import",
        "analyze",
        "worksheet",
        "axis_preview",
        "worksheet_pdf",
        "worksheet_report_pdf",
        "statistics_csv",
        "plot_pdf",
        "plot_svg",
        "pdf",
        "save",
        "save_template",
        "load_template",
        "load",
    ]
    .contains(&action)
    {
        return Err("Unsupported analysis action".into());
    }
    payload["storage"] = storage.to_string_lossy().into_owned().into();
    std::fs::create_dir_all(storage).map_err(|e| e.to_string())?;
    let mut guard = state().lock().map_err(|_| "Worker lock failed")?;
    if guard.as_ref().map_or(true, |w| w.script != script) {
        *guard = Some(Worker::start(script)?);
    }
    let mut input = serde_json::to_vec(&payload).map_err(|e| e.to_string())?;
    input.push(b'\n');
    let worker = guard.as_mut().unwrap();
    if let Err(e) = worker
        .input
        .write_all(&input)
        .and_then(|_| worker.input.flush())
    {
        *guard = None;
        return Err(format!("R worker stopped; retry the operation: {e}"));
    }
    let output = match worker.output.recv_timeout(Duration::from_secs(180)) {
        Ok(Ok(line)) => line,
        other => {
            *guard = None;
            return Err(format!(
                "R worker stopped or timed out; next request will restart it: {other:?}"
            ));
        }
    };
    let result: Value = match serde_json::from_str(&output) {
        Ok(v) => v,
        Err(e) => {
            *guard = None;
            return Err(format!("Invalid R response: {e}"));
        }
    };
    if result["ok"] != true {
        return Err(result["error"]
            .as_str()
            .unwrap_or("R analysis failed")
            .into());
    }
    let mut data = result["data"].clone();
    if payload["action"] == "worksheet_pdf" || payload["action"] == "worksheet_report_pdf" {
        if let Some(page_files) = data["pageFiles"].as_array() {
            let files: Vec<PathBuf> = page_files
                .iter()
                .filter_map(|value| value.as_str().map(PathBuf::from))
                .collect();
            let output = payload["path"].as_str().ok_or("Missing PDF output path")?;
            let merged = super::pdf::merge_pages(&files, &PathBuf::from(output));
            for file in files {
                let _ = std::fs::remove_file(file);
            }
            merged?;
            data.as_object_mut().map(|object| object.remove("pageFiles"));
        }
    }
    Ok(data)
}
