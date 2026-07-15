#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod sidecar;

use std::sync::Arc;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

use sidecar::{LifecycleState, SidecarManager};

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

pub fn run() {
    let manager = Arc::new(SidecarManager::new());
    let setup_manager = Arc::clone(&manager);
    let event_manager = Arc::clone(&manager);

    tauri::Builder::default()
        .setup(move |app| {
            setup_manager
                .start(app.handle())
                .map_err(|error| Box::<dyn std::error::Error>::from(error))?;
            build_main_window(app.handle(), &setup_manager)
                .map_err(|error| Box::<dyn std::error::Error>::from(error))?;
            app.manage(Arc::clone(&setup_manager));
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to build OperatorOS desktop shell")
        .run(move |_app, event| {
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
