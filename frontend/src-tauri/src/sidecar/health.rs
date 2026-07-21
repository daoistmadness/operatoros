use serde::Deserialize;
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::time::{Duration, Instant};

use super::process::ManagedProcess;

#[derive(Debug)]
pub enum HealthError {
    ConnectionRefused(String),
    Incomplete(String),
    MalformedResponse(String),
    IdentityMismatch(String),
    Timeout,
    Crash(String),
}

impl std::fmt::Display for HealthError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::ConnectionRefused(msg) => write!(f, "Connection refused: {}", msg),
            Self::Incomplete(msg) => write!(f, "Incomplete readiness: {}", msg),
            Self::MalformedResponse(msg) => write!(f, "Malformed response: {}", msg),
            Self::IdentityMismatch(msg) => write!(f, "Identity/version mismatch: {}", msg),
            Self::Timeout => write!(f, "Readiness timeout"),
            Self::Crash(msg) => write!(f, "Backend crashed: {}", msg),
        }
    }
}

#[derive(Debug, Deserialize)]
struct HealthPayload {
    status: String,
    service: String,
    version: String,
}

fn request_health(port: u16, timeout: Duration) -> Result<HealthPayload, HealthError> {
    let address = SocketAddr::from(([127, 0, 0, 1], port));
    let mut stream = TcpStream::connect_timeout(&address, timeout)
        .map_err(|error| HealthError::ConnectionRefused(error.to_string()))?;
    stream
        .set_read_timeout(Some(timeout))
        .map_err(|error| HealthError::ConnectionRefused(error.to_string()))?;
    stream
        .write_all(b"GET /health HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n")
        .map_err(|error| HealthError::ConnectionRefused(error.to_string()))?;
    let mut response = String::new();
    stream
        .read_to_string(&mut response)
        .map_err(|error| HealthError::Incomplete(error.to_string()))?;
    let (headers, body) = response
        .split_once("\r\n\r\n")
        .ok_or_else(|| HealthError::MalformedResponse("Missing HTTP headers".into()))?;
    if !headers.starts_with("HTTP/1.1 200") && !headers.starts_with("HTTP/1.0 200") {
        return Err(HealthError::Incomplete("HTTP 200 not returned".into()));
    }
    serde_json::from_str(body).map_err(|error| HealthError::MalformedResponse(error.to_string()))
}

pub fn wait_until_ready(
    process: &mut ManagedProcess,
    port: u16,
    version: &str,
    timeout: Duration,
) -> Result<(), HealthError> {
    let deadline = Instant::now() + timeout;
    let mut last_error = HealthError::Timeout;

    // Exponential backoff for polling
    let mut backoff_ms = 100;

    while Instant::now() < deadline {
        if let Some(status) = process
            .try_wait()
            .map_err(|e| HealthError::Crash(e.to_string()))?
        {
            return Err(HealthError::Crash(status.to_string()));
        }
        match request_health(port, Duration::from_millis(750)) {
            Ok(payload)
                if payload.status == "ok"
                    && payload.service == "operatoros-sidecar"
                    && payload.version == version =>
            {
                return Ok(());
            }
            Ok(_) => {
                last_error =
                    HealthError::IdentityMismatch("Service or version does not match".into())
            }
            Err(error) => last_error = error,
        }
        std::thread::sleep(Duration::from_millis(backoff_ms));
        backoff_ms = std::cmp::min(backoff_ms * 2, 1000);
    }
    Err(last_error)
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
                last_error = error.to_string();
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        assert!(started.elapsed() >= Duration::from_millis(150));
        assert!(last_error.contains("Connection refused"));
    }
}
