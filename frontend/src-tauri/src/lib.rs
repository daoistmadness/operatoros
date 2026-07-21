#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod sidecar;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{Manager, State, WebviewUrl, WebviewWindowBuilder};

use sidecar::{LifecycleState, SidecarManager};

#[tauri::command]
fn get_lifecycle_state(
    manager: State<'_, Arc<SidecarManager>>,
) -> Result<serde_json::Value, String> {
    let state = manager.state();
    let message = manager.error_message().unwrap_or_default();

    // Include runtime URL if ready
    let mut payload = serde_json::json!({
        "state": state,
        "message": message,
    });

    if state == LifecycleState::Ready {
        if let Some(runtime) = manager.runtime() {
            payload["url"] = format!("http://127.0.0.1:{}", runtime.port).into();
        }
    }

    Ok(payload)
}

#[tauri::command]
fn retry_startup(
    app: tauri::AppHandle,
    manager: State<'_, Arc<SidecarManager>>,
) -> Result<(), String> {
    manager.retry(&app)
}

#[tauri::command]
fn exit_application(app: tauri::AppHandle) {
    app.exit(0);
}

#[tauri::command]
fn launch_main_window(
    app: tauri::AppHandle,
    manager: State<'_, Arc<SidecarManager>>,
) -> Result<(), String> {
    let _ = build_main_window(&app, &manager);
    Ok(())
}

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

    if let Some(startup_window) = app.get_webview_window("startup") {
        let _ = startup_window.close();
    }

    // Close existing main window if any (just in case)
    if let Some(existing_main) = app.get_webview_window("main") {
        let _ = existing_main.close();
    }

    WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
        .title("OperatorOS")
        .inner_size(1280.0, 800.0)
        .min_inner_size(960.0, 640.0)
        .initialization_script(&initialization_script)
        .build()
        .map_err(|error| format!("could not create OperatorOS window: {error}"))?;
    Ok(())
}

fn build_startup_window(app: &tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.close();
    }

    WebviewWindowBuilder::new(
        app,
        "startup",
        WebviewUrl::App("desktop-startup.html".into()),
    )
    .title("OperatorOS — Starting Up")
    .inner_size(720.0, 520.0)
    .min_inner_size(640.0, 440.0)
    .resizable(true)
    .build()
    .map_err(|build_error| format!("could not create startup window: {build_error}"))?;
    Ok(())
}

pub fn run() {
    let manager = Arc::new(SidecarManager::new());
    let setup_manager = Arc::clone(&manager);
    let event_manager = Arc::clone(&manager);

    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            get_lifecycle_state,
            retry_startup,
            exit_application,
            launch_main_window
        ])
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(main_window) = app.get_webview_window("main") {
                let _ = main_window.show();
                let _ = main_window.set_focus();
            } else if let Some(startup_window) = app.get_webview_window("startup") {
                let _ = startup_window.show();
                let _ = startup_window.set_focus();
            }
        }))
        .setup(move |app| {
            #[cfg(debug_assertions)]
            if let Ok(origin) = std::env::var("OPERATOROS_TAURI_DEV_URL") {
                build_managed_dev_window(app.handle(), &origin)
                    .map_err(|error| Box::<dyn std::error::Error>::from(error))?;
                app.manage(Arc::clone(&setup_manager));
                return Ok(());
            }

            app.manage(Arc::clone(&setup_manager));

            build_startup_window(app.handle())
                .map_err(|window_error| Box::<dyn std::error::Error>::from(window_error))?;

            let _ = setup_manager.start(app.handle());

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
