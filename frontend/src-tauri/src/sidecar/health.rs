use serde::Deserialize;
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::time::{Duration, Instant};

use super::process::ManagedProcess;

#[derive(Debug, Deserialize)]
struct HealthPayload {
    status: String,
    service: String,
    version: String,
}

fn request_health(port: u16, timeout: Duration) -> Result<HealthPayload, String> {
    let address = SocketAddr::from(([127, 0, 0, 1], port));
    let mut stream = TcpStream::connect_timeout(&address, timeout)
        .map_err(|error| format!("health connection failed: {error}"))?;
    stream
        .set_read_timeout(Some(timeout))
        .map_err(|error| error.to_string())?;
    stream
        .write_all(b"GET /health HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n")
        .map_err(|error| error.to_string())?;
    let mut response = String::new();
    stream
        .read_to_string(&mut response)
        .map_err(|error| error.to_string())?;
    let (headers, body) = response
        .split_once("\r\n\r\n")
        .ok_or("invalid health response")?;
    if !headers.starts_with("HTTP/1.1 200") && !headers.starts_with("HTTP/1.0 200") {
        return Err("health endpoint did not return HTTP 200".into());
    }
    serde_json::from_str(body).map_err(|error| format!("invalid health JSON: {error}"))
}

pub fn wait_until_ready(
    process: &mut ManagedProcess,
    port: u16,
    version: &str,
    timeout: Duration,
) -> Result<(), String> {
    let deadline = Instant::now() + timeout;
    let mut last_error = String::from("sidecar has not responded");
    while Instant::now() < deadline {
        if let Some(status) = process.try_wait()? {
            return Err(format!("sidecar exited before readiness: {status}"));
        }
        match request_health(port, Duration::from_millis(750)) {
            Ok(payload)
                if payload.status == "ok"
                    && payload.service == "operatoros-sidecar"
                    && payload.version == version =>
            {
                return Ok(())
            }
            Ok(_) => last_error = "health identity/version mismatch".into(),
            Err(error) => last_error = error,
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    Err(format!("sidecar readiness timed out: {last_error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unavailable_health_endpoint_times_out() {
        let listener = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        drop(listener);
        let started = Instant::now();
        let deadline = started + Duration::from_millis(150);
        let mut last_error = String::new();
        while Instant::now() < deadline {
            if let Err(error) = request_health(port, Duration::from_millis(25)) {
                last_error = error;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        assert!(started.elapsed() >= Duration::from_millis(150));
        assert!(last_error.contains("health connection failed"));
    }
}
