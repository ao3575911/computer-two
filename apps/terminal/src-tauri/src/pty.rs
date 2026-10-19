use std::io::{Read, Write};
use std::sync::Mutex;
use std::thread;

use portable_pty::{Child, CommandBuilder, MasterPty, PtySize, native_pty_system};
use tauri::{AppHandle, Emitter, State};

const OUTPUT_EVENT: &str = "pty-output";
const CLOSED_EVENT: &str = "pty-closed";

pub struct PtyState {
    session: Mutex<Option<PtySession>>,
}

struct PtySession {
    writer: Box<dyn Write + Send>,
    master: Box<dyn MasterPty + Send>,
    child: Box<dyn Child + Send + Sync>,
}

impl PtyState {
    pub fn new() -> Self {
        Self {
            session: Mutex::new(None),
        }
    }
}

impl Drop for PtySession {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

#[tauri::command]
pub fn open_shell(
    app: AppHandle,
    state: State<'_, PtyState>,
    rows: u16,
    cols: u16,
) -> Result<(), String> {
    let mut session = state
        .session
        .lock()
        .map_err(|_| "shell state is unavailable".to_string())?;
    if session.is_some() {
        return Ok(());
    }

    let size = pty_size(rows, cols)?;
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(size)
        .map_err(|error| error.to_string())?;
    let mut command = CommandBuilder::new(shell_program());
    command.env("TERM", "xterm-256color");
    command.env("COLORTERM", "truecolor");
    let child = pair
        .slave
        .spawn_command(command)
        .map_err(|error| error.to_string())?;
    drop(pair.slave);
    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|error| error.to_string())?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|error| error.to_string())?;
    *session = Some(PtySession {
        writer,
        master: pair.master,
        child,
    });
    drop(session);
    spawn_reader(app, reader);
    Ok(())
}

#[tauri::command]
pub fn write_pty(state: State<'_, PtyState>, data: Vec<u8>) -> Result<(), String> {
    let mut session = state
        .session
        .lock()
        .map_err(|_| "shell state is unavailable".to_string())?;
    let session = session.as_mut().ok_or("shell is not open")?;
    session
        .writer
        .write_all(&data)
        .map_err(|error| error.to_string())?;
    session.writer.flush().map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn resize_pty(state: State<'_, PtyState>, rows: u16, cols: u16) -> Result<(), String> {
    let session = state
        .session
        .lock()
        .map_err(|_| "shell state is unavailable".to_string())?;
    let session = session.as_ref().ok_or("shell is not open")?;
    session
        .master
        .resize(pty_size(rows, cols)?)
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn pty_size(rows: u16, cols: u16) -> Result<PtySize, String> {
    if rows == 0 || cols == 0 {
        return Err("pty size must be at least 1 by 1".to_string());
    }
    Ok(PtySize {
        rows,
        cols,
        pixel_width: 0,
        pixel_height: 0,
    })
}

fn shell_program() -> String {
    match std::env::var("SHELL") {
        Ok(program) if program.starts_with('/') => program,
        _ => "/bin/bash".to_string(),
    }
}

fn spawn_reader(app: AppHandle, mut reader: Box<dyn Read + Send>) {
    thread::spawn(move || {
        let mut buffer = [0_u8; 8192];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => {
                    let _ = app.emit(CLOSED_EVENT, ());
                    break;
                }
                Ok(count) => {
                    if app.emit(OUTPUT_EVENT, buffer[..count].to_vec()).is_err() {
                        break;
                    }
                }
                Err(error) if error.kind() == std::io::ErrorKind::Interrupted => {}
                Err(_) => {
                    let _ = app.emit(CLOSED_EVENT, ());
                    break;
                }
            }
        }
    });
}
