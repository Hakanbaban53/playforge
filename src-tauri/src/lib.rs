/// PlayForge — Tauri backend with auto-update support.
///
/// Plugins:
///   - `tauri-plugin-fs` — file read/write
///   - `tauri-plugin-dialog` — native file pickers
///   - `tauri-plugin-updater` — auto-update from GitHub releases
///   - `tauri-plugin-process` — app restart after update
///   - `tauri-plugin-single-instance` — prevent multiple instances
///
/// Update commands:
///   - `check_for_updates` — check GitHub releases for a newer version
///   - `download_update` — download the update in background
///   - `install_and_restart` — install the downloaded update and restart
///
/// The frontend `UpdateService` (TS) calls these commands only when running
/// inside Tauri. In web mode, the update UI is hidden.
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct UpdateInfo {
    pub version: String,
    pub current_version: String,
    pub release_notes: Option<String>,
    pub release_url: Option<String>,
    pub download_size: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DownloadProgress {
    pub downloaded: u64,
    pub total: u64,
    pub percentage: f64,
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[tauri::command]
async fn check_for_updates(app: tauri::AppHandle) -> Result<Option<UpdateInfo>, String> {
    log::info!("Checking for updates...");
    use tauri::Emitter;
    use tauri_plugin_updater::UpdaterExt;

    let updater = match app.updater_builder().build() {
        Ok(u) => u,
        Err(e) => {
            log::warn!("Updater build failed (likely no endpoints configured): {e}");
            return Ok(None);
        }
    };

    let update = match updater.check().await {
        Ok(Some(u)) => {
            log::info!("Update available: v{}", u.version);
            u
        }
        Ok(None) => {
            log::info!("App is up to date");
            return Ok(None);
        }
        Err(e) => {
            log::warn!("Update check failed: {e}");
            return Err(format!("Update check failed: {e}"));
        }
    };

    let info = UpdateInfo {
        version: update.version.clone(),
        current_version: update.current_version.clone(),
        release_notes: None,
        release_url: None,
        download_size: None,
    };

    // Store the update object in app state for later download.
    // We use a simple approach: emit an event with the update info, and
    // the download command re-checks (the updater caches).
    app.emit("update-available", &info).ok();

    Ok(Some(info))
}

/// Download and install the update, then restart the app.
/// Emits progress events during download.
#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[tauri::command]
async fn download_and_install_update(app: tauri::AppHandle) -> Result<(), String> {
    log::info!("Downloading and installing update...");
    use tauri::Emitter;
    use tauri_plugin_updater::UpdaterExt;

    let updater = app
        .updater_builder()
        .build()
        .map_err(|e| format!("Failed to build updater: {e}"))?;

    let update = updater
        .check()
        .await
        .map_err(|e| format!("Update check failed: {e}"))?
        .ok_or("No update available")?;

    let app_clone = app.clone();

    let bytes = update
        .download(
            move |chunk_length, content_length| {
                let downloaded = chunk_length as u64;
                let total = content_length.unwrap_or(0);
                let percentage = if total > 0 {
                    (downloaded as f64 / total as f64) * 100.0
                } else {
                    0.0
                };
                let progress = DownloadProgress {
                    downloaded,
                    total,
                    percentage,
                };
                let _ = app_clone.emit("update-progress", &progress);
            },
            || {
                log::info!("Update download completed");
            },
        )
        .await
        .map_err(|e| format!("Download failed: {e}"))?;

    // Install the update — this replaces the app binary.
    log::info!("Installing update...");
    update
        .install(bytes)
        .map_err(|e| format!("Install failed: {e}"))?;

    // Restart the app.
    log::info!("Restarting app after update...");
    app.restart();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default();

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            use tauri::Manager;

            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }));
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        builder = builder.plugin(tauri_plugin_window_state::Builder::default().build());
    }

    builder = builder
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init());

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    }

    builder
        .setup(|app| {
            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            {
                #[allow(unused_mut)]
                let mut b =
                    tauri::WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::default())
                        .title("PlayForge")
                        .inner_size(800.0, 630.0)
                        .resizable(true)
                        .center()
                        .devtools(true)
                        .shadow(false)
                        .min_inner_size(362.0, 240.0);

                #[cfg(target_os = "windows")]
                {
                    use tauri::webview::ScrollBarStyle;
                    b = b.scroll_bar_style(ScrollBarStyle::FluentOverlay);
                }

                let _window = b.build()?;
            }

            #[cfg(any(target_os = "android", target_os = "ios"))]
            {
                let _window =
                    tauri::WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::default())
                        .user_agent("Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36")
                        .build()?;
            }

            // Periodic update check every 6 hours (sleeps 6 hours initially)
            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            {
                use tauri::Emitter;
                use tauri_plugin_updater::UpdaterExt;

                let app_handle = app.handle().clone();
                std::thread::spawn(move || {
                    loop {
                        // Sleep 6 hours first, since the frontend checks on startup
                        std::thread::sleep(std::time::Duration::from_secs(6 * 60 * 60));

                        log::info!("Checking for updates (periodic background thread)...");
                        let app_handle = app_handle.clone();
                        tauri::async_runtime::block_on(async move {
                            let updater = match app_handle.updater_builder().build() {
                                Ok(u) => u,
                                Err(e) => {
                                    log::warn!("Periodic updater build failed: {e}");
                                    return;
                                }
                            };

                            match updater.check().await {
                                Ok(Some(update)) => {
                                    log::info!("Update available (periodic): v{}", update.version);
                                    let info = UpdateInfo {
                                        version: update.version.clone(),
                                        current_version: update.current_version.clone(),
                                        release_notes: None,
                                        release_url: None,
                                        download_size: None,
                                    };
                                    let _ = app_handle.emit("update-available", &info);
                                }
                                Ok(None) => {
                                    log::info!("App is up to date (periodic check)");
                                }
                                Err(e) => {
                                    log::warn!("Periodic update check failed: {e}");
                                }
                            }
                        });
                    }
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            check_for_updates,
            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            download_and_install_update,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
