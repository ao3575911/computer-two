mod check;
mod pty;

#[cfg(target_os = "linux")]
use atk::prelude::AtkObjectExt;
#[cfg(target_os = "linux")]
use gtk::prelude::WidgetExt;
#[cfg(target_os = "linux")]
use tauri::Manager;

use check::run_failing_add_check;
use pty::{PtyState, open_shell, resize_pty, write_pty};

const ACCESSIBLE_NAME: &str = "Computer Two";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(PtyState::new())
        .setup(|app| {
            #[cfg(target_os = "linux")]
            set_linux_accessible_name(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            open_shell,
            write_pty,
            resize_pty,
            run_failing_add_check
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(target_os = "linux")]
fn set_linux_accessible_name(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| std::io::Error::other("main window is missing"))?;
    let gtk_window = window.gtk_window()?;
    apply_accessible_name(&gtk_window);
    gtk_window.connect_map(|mapped_window| {
        apply_accessible_name(mapped_window);
    });
    Ok(())
}

#[cfg(target_os = "linux")]
fn apply_accessible_name(window: &impl WidgetExt) {
    if let Some(accessible) = window.accessible() {
        accessible.set_name(ACCESSIBLE_NAME);
    }
}
