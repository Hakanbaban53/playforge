use log::{LevelFilter, Metadata, Record};
use std::sync::atomic::{AtomicUsize, Ordering};
use tauri::{AppHandle, Manager};

use super::file_writer::write_to_file;

static LOG_LEVEL: AtomicUsize = AtomicUsize::new(LevelFilter::Info as usize);

struct SimpleLogger;

impl log::Log for SimpleLogger {
    fn enabled(&self, metadata: &Metadata) -> bool {
        metadata.level() as usize <= LOG_LEVEL.load(Ordering::Relaxed)
    }

    fn log(&self, record: &Record) {
        if self.enabled(record.metadata()) {
            let log_line = format!(
                "[{} {} {}]: {}",
                chrono::Local::now().format("%Y-%m-%d %H:%M:%S"),
                record.level(),
                record.target(),
                record.args()
            );

            // Write to console
            println!("{}", log_line);

            // Write to rotating log file
            write_to_file(&log_line);
        }
    }

    fn flush(&self) {}
}

static LOGGER: SimpleLogger = SimpleLogger;

pub fn init_logging(app_handle: &AppHandle) -> Result<(), String> {
    // Set up file recording
    let app_dir = app_handle.path().app_data_dir().unwrap();
    let log_dir = app_dir.join("logs");

    if let Err(e) = super::file_writer::init_file_writer(&log_dir) {
        eprintln!("Failed to initialize file logger: {e}");
        // We continue even if file logging fails, to support console logging
    }

    log::set_logger(&LOGGER)
        .map(|()| log::set_max_level(LevelFilter::Info))
        .map_err(|e| e.to_string())?;

    Ok(())
}
