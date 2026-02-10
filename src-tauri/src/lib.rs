mod builder;
pub mod database;
mod utils;

use log::info;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                info!("📢 Second instance detected, showing existing window");
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_os::init())
        .setup(|app| {
            utils::logging::log::init_logging(app.handle())?;
            database::init_db(app.handle())?;
            builder::create_app_window(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            database::get_product_by_code,
            database::add_product,
            database::update_product,
            database::get_all_products,
            database::save_product_image,
            database::get_setting,
            database::save_setting
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
