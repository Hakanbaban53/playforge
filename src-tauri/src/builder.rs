use tauri::{AppHandle, WebviewUrl, WebviewWindowBuilder};

pub fn create_app_window(app_handle: &AppHandle) {
    let main_window = WebviewWindowBuilder::new(app_handle, "main", WebviewUrl::default())
        .title("ParkMan")
        .inner_size(800.0, 600.0)
        .min_inner_size(362.0, 240.0)
        .resizable(true)
        .center()
        .shadow(false)
        .decorations(false)
        .build()
        .expect("Failed to build main window");

    main_window.show().unwrap();
}
