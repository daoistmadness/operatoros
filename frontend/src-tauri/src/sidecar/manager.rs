use serde::Serialize;
use std::fs;
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::Manager;

use super::health::wait_until_ready;
use super::instance_lock::InstanceLock;
use super::lifecycle::LifecycleState;
use super::process::ManagedProcess;

#[derive(Clone, Debug, Serialize)]
pub struct RuntimeConfiguration {
    pub port: u16,
    pub data_dir: PathBuf,
    pub log_dir: PathBuf,
    pub runtime_dir: PathBuf,
    pub version: String,
}

struct Inner {
    state: LifecycleState,
    runtime: Option<RuntimeConfiguration>,
    process: Option<ManagedProcess>,
    instance_lock: Option<InstanceLock>,
}

pub struct SidecarManager {
    inner: Arc<Mutex<Inner>>,
}

impl SidecarManager {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(Inner {
                state: LifecycleState::Stopped,
                runtime: None,
                process: None,
                instance_lock: None,
            })),
        }
    }

    pub fn state(&self) -> LifecycleState {
        self.inner.lock().expect("sidecar state poisoned").state
    }

    pub fn runtime(&self) -> Option<RuntimeConfiguration> {
        self.inner
            .lock()
            .expect("sidecar state poisoned")
            .runtime
            .clone()
    }

    fn transition(inner: &mut Inner, next: LifecycleState) -> Result<(), String> {
        if !inner.state.can_transition_to(next) {
            return Err(format!(
                "invalid lifecycle transition {:?} -> {:?}",
                inner.state, next
            ));
        }
        inner.state = next;
        Ok(())
    }

    pub fn start(&self, app: &tauri::AppHandle) -> Result<(), String> {
        let instance_lock = InstanceLock::acquire()?;
        {
            let mut inner = self.inner.lock().map_err(|_| "sidecar state poisoned")?;
            Self::transition(&mut inner, LifecycleState::Starting)?;
            inner.instance_lock = Some(instance_lock);
        }

        let result = self.start_inner(app);
        if let Err(error) = result {
            let mut inner = self.inner.lock().map_err(|_| "sidecar state poisoned")?;
            if let Some(runtime) = inner.runtime.as_ref() {
                let _ = write_lifecycle_log(runtime, "FAILED", &error);
            } else if let Ok(root) = operatoros_root() {
                let _ = write_root_lifecycle_log(&root, "FAILED", &error);
            }
            inner.process = None;
            inner.instance_lock = None;
            let _ = Self::transition(&mut inner, LifecycleState::Failed);
            return Err(error);
        }
        Ok(())
    }

    fn start_inner(&self, app: &tauri::AppHandle) -> Result<(), String> {
        let root = operatoros_root()?;
        let runtime = create_runtime(&root, app.package_info().version.to_string())?;
        {
            let mut inner = self.inner.lock().map_err(|_| "sidecar state poisoned")?;
            inner.runtime = Some(runtime.clone());
        }
        write_lifecycle_log(&runtime, "STARTING", "sidecar startup attempt")?;
        let executable = resolve_sidecar(app)?;
        let stdout = runtime.log_dir.join("sidecar-stdout.log");
        let stderr = runtime.log_dir.join("sidecar-stderr.log");
        let mut process = ManagedProcess::spawn(&executable, &runtime, &stdout, &stderr)?;
        if let Err(error) = wait_until_ready(
            &mut process,
            runtime.port,
            &runtime.version,
            health_timeout(),
        ) {
            let _ = process.graceful_stop(Duration::from_secs(10));
            return Err(error);
        }
        let mut inner = self.inner.lock().map_err(|_| "sidecar state poisoned")?;
        inner.process = Some(process);
        inner.runtime = Some(runtime);
        Self::transition(&mut inner, LifecycleState::Ready)?;
        if let Some(runtime) = inner.runtime.as_ref() {
            let _ = write_lifecycle_log(runtime, "READY", "sidecar health check accepted");
        }
        drop(inner);
        self.start_crash_monitor();
        Ok(())
    }

    fn start_crash_monitor(&self) {
        let weak = Arc::downgrade(&self.inner);
        std::thread::spawn(move || loop {
            let Some(shared) = weak.upgrade() else { return };
            let mut inner = match shared.lock() {
                Ok(inner) => inner,
                Err(_) => return,
            };
            if inner.state != LifecycleState::Ready {
                return;
            }
            let exited = inner
                .process
                .as_mut()
                .and_then(|process| process.try_wait().ok().flatten());
            if let Some(status) = exited {
                if let Some(runtime) = inner.runtime.as_ref() {
                    let _ = write_lifecycle_log(
                        runtime,
                        "CRASHED",
                        &format!("sidecar exited unexpectedly: {status}"),
                    );
                }
                inner.process = None;
                let _ = Self::transition(&mut inner, LifecycleState::Crashed);
                return;
            }
            drop(inner);
            std::thread::sleep(Duration::from_millis(250));
        });
    }

    pub fn shutdown(&self) -> Result<(), String> {
        let mut process = {
            let mut inner = self.inner.lock().map_err(|_| "sidecar state poisoned")?;
            if inner.state == LifecycleState::Stopped {
                return Ok(());
            }
            Self::transition(&mut inner, LifecycleState::Stopping)?;
            inner.process.take()
        };
        let result = process
            .as_mut()
            .map(|child| child.graceful_stop(Duration::from_secs(20)))
            .transpose();
        let mut inner = self.inner.lock().map_err(|_| "sidecar state poisoned")?;
        inner.runtime = None;
        inner.instance_lock = None;
        Self::transition(&mut inner, LifecycleState::Stopped)?;
        result.map(|_| ())
    }
}

fn health_timeout() -> Duration {
    let seconds = std::env::var("OPERATOROS_HEALTH_TIMEOUT_SECONDS")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .filter(|value| (1..=90).contains(value))
        .unwrap_or(90);
    Duration::from_secs(seconds)
}

fn lifecycle_line(state: &str, message: &str) -> String {
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let sanitized = message.replace(['\r', '\n'], " ");
    format!("timestamp_unix={timestamp} state={state} message={sanitized}\n")
}

fn write_root_lifecycle_log(root: &Path, state: &str, message: &str) -> Result<(), String> {
    let log_dir = root.join("Logs");
    fs::create_dir_all(&log_dir)
        .map_err(|error| format!("could not create {}: {error}", log_dir.display()))?;
    fs::write(
        log_dir.join("desktop-runtime.log"),
        lifecycle_line(state, message),
    )
    .map_err(|error| format!("could not write desktop runtime log: {error}"))
}

fn write_lifecycle_log(
    runtime: &RuntimeConfiguration,
    state: &str,
    message: &str,
) -> Result<(), String> {
    use std::io::Write;
    let path = runtime.log_dir.join("desktop-runtime.log");
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|error| format!("could not open {}: {error}", path.display()))?;
    file.write_all(lifecycle_line(state, message).as_bytes())
        .map_err(|error| format!("could not write {}: {error}", path.display()))
}

fn operatoros_root() -> Result<PathBuf, String> {
    let local = std::env::var_os("LOCALAPPDATA").ok_or("LOCALAPPDATA is unavailable")?;
    Ok(PathBuf::from(local).join("OperatorOS"))
}

fn allocate_port() -> Result<u16, String> {
    let listener = TcpListener::bind(("127.0.0.1", 0))
        .map_err(|error| format!("could not allocate loopback port: {error}"))?;
    listener
        .local_addr()
        .map(|address| address.port())
        .map_err(|error| error.to_string())
}

fn create_runtime(root: &Path, version: String) -> Result<RuntimeConfiguration, String> {
    let data_dir = root.join("Data");
    let log_dir = root.join("Logs");
    let runtime_dir = root.join("Runtime");
    for directory in [
        &data_dir,
        &root.join("Backups"),
        &log_dir,
        &runtime_dir,
        &root.join("Exports"),
    ] {
        fs::create_dir_all(directory)
            .map_err(|error| format!("could not create {}: {error}", directory.display()))?;
    }
    let configuration = RuntimeConfiguration {
        port: allocate_port()?,
        data_dir,
        log_dir,
        runtime_dir: runtime_dir.clone(),
        version,
    };
    let json = serde_json::to_vec_pretty(&configuration).map_err(|error| error.to_string())?;
    fs::write(runtime_dir.join("runtime.json"), json)
        .map_err(|error| format!("could not write runtime.json: {error}"))?;
    Ok(configuration)
}

fn resolve_sidecar(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let packaged = app
        .path()
        .resource_dir()
        .map_err(|error| error.to_string())?
        .join("resources")
        .join("operatoros-sidecar.exe");
    if packaged.is_file() {
        return Ok(packaged);
    }
    let development = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("dist")
        .join("operatoros-sidecar.exe");
    if development.is_file() {
        return development
            .canonicalize()
            .map_err(|error| error.to_string());
    }
    Err("operatoros-sidecar.exe was not found in packaged resources or repository dist".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn runtime_json_contains_no_secret_fields() {
        let value = serde_json::to_value(RuntimeConfiguration {
            port: 54321,
            data_dir: PathBuf::from(r"C:\Users\Test\AppData\Local\OperatorOS\Data"),
            log_dir: PathBuf::from(r"C:\Users\Test\AppData\Local\OperatorOS\Logs"),
            runtime_dir: PathBuf::from(r"C:\Users\Test\AppData\Local\OperatorOS\Runtime"),
            version: "0.1.0".into(),
        })
        .unwrap();
        let text = value.to_string().to_lowercase();
        assert!(!text.contains("password"));
        assert!(!text.contains("secret"));
        assert!(!text.contains("cookie"));
        assert_eq!(value["port"], 54321);
    }

    #[test]
    fn port_allocation_is_dynamic_and_loopback() {
        let first = allocate_port().unwrap();
        let second = allocate_port().unwrap();
        assert!(first > 0 && second > 0);
    }

    #[test]
    fn lifecycle_log_has_timestamp_state_and_single_line_message() {
        let line = lifecycle_line("FAILED", "missing\nsidecar");
        assert!(line.starts_with("timestamp_unix="));
        assert!(line.contains(" state=FAILED "));
        assert!(line.contains("message=missing sidecar"));
        assert_eq!(line.lines().count(), 1);
    }

    #[test]
    fn health_timeout_defaults_to_release_contract() {
        std::env::remove_var("OPERATOROS_HEALTH_TIMEOUT_SECONDS");
        assert_eq!(health_timeout(), Duration::from_secs(90));
    }
}
