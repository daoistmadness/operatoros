use std::fs::{File, OpenOptions};
use std::path::Path;
use std::process::{Child, Command, ExitStatus, Stdio};
use std::time::{Duration, Instant};

use super::job_object::JobObject;
use super::manager::RuntimeConfiguration;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

pub struct ManagedProcess {
    child: Child,
    _job: JobObject,
}

impl ManagedProcess {
    pub fn spawn(
        executable: &Path,
        runtime: &RuntimeConfiguration,
        stdout_path: &Path,
        stderr_path: &Path,
    ) -> Result<Self, String> {
        if !executable.is_file() {
            return Err(format!("executable not found at {}", executable.display()));
        }
        let stdout = create_log(stdout_path)?;
        let stderr = create_log(stderr_path)?;
        let mut command = Command::new(executable);
        command
            .arg("--port")
            .arg(runtime.port.to_string())
            .env("OPERATOROS_DATA_DIR", &runtime.data_dir)
            .env("OPERATOROS_LOG_DIR", &runtime.log_dir)
            .env("OPERATOROS_RUNTIME_DIR", &runtime.runtime_dir)
            .env("OPERATOROS_VERSION", &runtime.version)
            .stdin(Stdio::null())
            .stdout(Stdio::from(stdout))
            .stderr(Stdio::from(stderr));
        #[cfg(windows)]
        command.creation_flags(0x0000_0200); // CREATE_NEW_PROCESS_GROUP

        let child = command
            .spawn()
            .map_err(|error| format!("could not spawn sidecar: {error}"))?;
        let job = JobObject::new()?;
        if let Err(error) = job.assign(&child) {
            let mut failed_child = child;
            let _ = failed_child.kill();
            let _ = failed_child.wait();
            return Err(error);
        }
        Ok(Self { child, _job: job })
    }

    pub fn id(&self) -> u32 {
        self.child.id()
    }

    pub fn try_wait(&mut self) -> Result<Option<ExitStatus>, String> {
        self.child.try_wait().map_err(|error| error.to_string())
    }

    pub fn graceful_stop(&mut self, timeout: Duration) -> Result<(), String> {
        if self.try_wait()?.is_some() {
            return Ok(());
        }
        send_ctrl_break(self.id())?;
        let deadline = Instant::now() + timeout;
        while Instant::now() < deadline {
            if self.try_wait()?.is_some() {
                return Ok(());
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        self.child.kill().map_err(|error| error.to_string())?;
        self.child.wait().map_err(|error| error.to_string())?;
        Ok(())
    }
}

fn create_log(path: &Path) -> Result<File, String> {
    OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|error| format!("could not open sidecar log {}: {error}", path.display()))
}

#[cfg(windows)]
fn send_ctrl_break(process_group: u32) -> Result<(), String> {
    use windows_sys::Win32::System::Console::{
        GenerateConsoleCtrlEvent, SetConsoleCtrlHandler, CTRL_BREAK_EVENT,
    };
    unsafe {
        SetConsoleCtrlHandler(None, 1);
        let result = GenerateConsoleCtrlEvent(CTRL_BREAK_EVENT, process_group);
        std::thread::sleep(Duration::from_millis(250));
        SetConsoleCtrlHandler(None, 0);
        if result == 0 {
            return Err(format!(
                "GenerateConsoleCtrlEvent failed: {}",
                std::io::Error::last_os_error()
            ));
        }
    }
    Ok(())
}

#[cfg(not(windows))]
fn send_ctrl_break(_process_group: u32) -> Result<(), String> {
    Err("graceful sidecar signaling is Windows-only".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn invalid_executable_is_reported_without_starting_a_process() {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("operatoros-process-test-{suffix}"));
        std::fs::create_dir_all(&root).unwrap();
        let runtime = RuntimeConfiguration {
            port: 54321,
            data_dir: root.join("Data"),
            log_dir: root.clone(),
            runtime_dir: root.join("Runtime"),
            version: "test".into(),
        };
        let result = ManagedProcess::spawn(
            &root.join("missing-sidecar.exe"),
            &runtime,
            &root.join("stdout.log"),
            &root.join("stderr.log"),
        );
        assert!(result.is_err());
        assert!(result.err().unwrap().contains("could not spawn sidecar"));
        let _ = std::fs::remove_dir_all(root);
    }
}
