#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod sidecar;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

use sidecar::{LifecycleState, SidecarManager};

#[cfg(debug_assertions)]
fn build_managed_dev_window(app: &tauri::AppHandle, origin: &str) -> Result<(), String> {
    let url = url::Url::parse(origin).map_err(|error| error.to_string())?;
    WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
        .title("OperatorOS")
        .inner_size(1280.0, 800.0)
        .min_inner_size(960.0, 640.0)
        .build()
        .map_err(|error| format!("could not create OperatorOS development window: {error}"))?;
    Ok(())
}

fn build_main_window(app: &tauri::AppHandle, manager: &SidecarManager) -> Result<(), String> {
    let runtime = manager.runtime().ok_or("sidecar runtime is unavailable")?;
    let origin = format!("http://127.0.0.1:{}", runtime.port);
    let url = url::Url::parse(&origin).map_err(|error| error.to_string())?;
    let runtime_json = serde_json::json!({
        "apiBaseUrl": origin,
        "port": runtime.port,
        "version": runtime.version,
    });
    let initialization_script = format!(
        "Object.defineProperty(window, '__OPERATOROS_RUNTIME__', {{ value: Object.freeze({0}), writable: false, configurable: false }});\
         Object.defineProperty(window, '__APP_CONFIG__', {{ value: Object.freeze({0}), writable: false, configurable: false }});",
        runtime_json
    );

    WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
        .title("OperatorOS")
        .inner_size(1280.0, 800.0)
        .min_inner_size(960.0, 640.0)
        .initialization_script(&initialization_script)
        .build()
        .map_err(|error| format!("could not create OperatorOS window: {error}"))?;
    Ok(())
}

fn build_failure_window(
    app: &tauri::AppHandle,
    state: LifecycleState,
    error: &str,
) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.close();
    }
    if let Some(window) = app.get_webview_window("failure") {
        let _ = window.close();
    }
    let payload = serde_json::json!({
        "state": state,
        "message": error,
    });
    let initialization_script = format!(
        "Object.defineProperty(window, '__OPERATOROS_FAILURE__', {{ value: Object.freeze({payload}), writable: false, configurable: false }});"
    );
    WebviewWindowBuilder::new(
        app,
        "failure",
        WebviewUrl::App("desktop-failure.html".into()),
    )
    .title("OperatorOS — Runtime Failure")
    .inner_size(720.0, 520.0)
    .min_inner_size(640.0, 440.0)
    .resizable(true)
    .initialization_script(&initialization_script)
    .build()
    .map_err(|build_error| format!("could not create failure window: {build_error}"))?;
    Ok(())
}

pub fn run() {
    let manager = Arc::new(SidecarManager::new());
    let setup_manager = Arc::clone(&manager);
    let event_manager = Arc::clone(&manager);
    let failure_presented = Arc::new(AtomicBool::new(false));
    let event_failure_presented = Arc::clone(&failure_presented);

    tauri::Builder::default()
        .setup(move |app| {
            #[cfg(debug_assertions)]
            if let Ok(origin) = std::env::var("OPERATOROS_TAURI_DEV_URL") {
                build_managed_dev_window(app.handle(), &origin)
                    .map_err(|error| Box::<dyn std::error::Error>::from(error))?;
                app.manage(Arc::clone(&setup_manager));
                return Ok(());
            }
            if let Err(error) = setup_manager.start(app.handle()) {
                build_failure_window(app.handle(), LifecycleState::Failed, &error)
                    .map_err(|window_error| Box::<dyn std::error::Error>::from(window_error))?;
                failure_presented.store(true, Ordering::SeqCst);
                app.manage(Arc::clone(&setup_manager));
                return Ok(());
            }
            build_main_window(app.handle(), &setup_manager)
                .map_err(|error| Box::<dyn std::error::Error>::from(error))?;
            app.manage(Arc::clone(&setup_manager));
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to build OperatorOS desktop shell")
        .run(move |app, event| {
            if event_manager.state() == LifecycleState::Crashed
                && !event_failure_presented.swap(true, Ordering::SeqCst)
            {
                let _ = build_failure_window(
                    app,
                    LifecycleState::Crashed,
                    "The OperatorOS backend stopped unexpectedly. Close OperatorOS, then reopen it. Diagnostic details were written to Logs\\desktop-runtime.log.",
                );
            }
            if matches!(
                event,
                tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit
            ) {
                if event_manager.state() != LifecycleState::Stopped {
                    let _ = event_manager.shutdown();
                }
            }
        });
}
