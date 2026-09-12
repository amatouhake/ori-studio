//! A private native session for an agent's layer search. It must not hold the
//! user's CpEngine mutex or share its single cancellation slot.
use oristudio_cp::{
    CreasePatternDocument,
    cancel::{CancelHandle, CancelSource, RunId},
    folding::{
        EstimationOrder, FoldedFigureModel, FoldedFigureRenderOptions, FoldedFigureRenderSnapshot,
        FoldedFigureSnapshot,
    },
    session::{CpSession, EngineError},
};
use serde::Serialize;
use std::{
    collections::HashMap,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant},
};
use tauri::{AppHandle, Manager, State, WebviewWindow};

struct Stop {
    cancelled: AtomicBool,
    running: AtomicBool,
    deadline: Instant,
}
impl Stop {
    fn new() -> Self {
        Self {
            cancelled: AtomicBool::new(false),
            running: AtomicBool::new(false),
            deadline: Instant::now() + Duration::from_secs(120),
        }
    }
}
impl CancelSource for Stop {
    fn cancelled_run(&self) -> u32 {
        u32::from(self.cancelled.load(Ordering::Relaxed) || Instant::now() >= self.deadline)
    }
}
#[derive(Clone, Default)]
pub struct Jobs(Arc<Mutex<HashMap<String, Arc<Stop>>>>);

#[derive(Serialize)]
pub struct FoldResult {
    cases: Vec<FoldedFigureSnapshot>,
    render: Option<FoldedFigureRenderSnapshot>,
}

#[tauri::command]
pub fn mcp_fold_prepare(
    window: WebviewWindow,
    access: State<'_, super::McpState>,
    jobs: State<'_, Jobs>,
) -> Result<String, String> {
    super::trusted(&window)?;
    if !super::status(&access)?.enabled {
        return Err("MCP access is disabled".into());
    }
    let mut active = jobs.0.lock().map_err(|_| "Fold job state unavailable")?;
    active.retain(|_, stop| stop.running.load(Ordering::Relaxed) || stop.cancelled_run() == 0);
    if active.len() >= 2 {
        return Err("At most two isolated native folds can run at once".into());
    }
    let id = uuid::Uuid::new_v4().to_string();
    active.insert(id.clone(), Arc::new(Stop::new()));
    Ok(id)
}

fn solve(
    document: CreasePatternDocument,
    starting_face: i32,
    case_limit: usize,
    stop: Arc<Stop>,
) -> Result<FoldResult, EngineError> {
    let source: Arc<dyn CancelSource> = stop;
    let _bound = oristudio_cp::cancel::bind(RunId::new(1).map(|id| CancelHandle::new(source, id)));
    let mut session = CpSession::new();
    let handle = session.load_document(document);
    let first = session.folded_figure_fold(
        handle,
        starting_face,
        EstimationOrder::Order5,
        FoldedFigureModel::default(),
    )?;
    let mut cases = vec![first.snapshot];
    for _ in 1..case_limit {
        if !cases.last().is_some_and(|s| s.find_another_overlap_valid) {
            break;
        }
        cases.push(session.folded_figure_fold_another(first.handle)?);
    }
    let render = session.folded_figure_render_snapshot(
        first.handle,
        None,
        FoldedFigureRenderOptions::default(),
    )?;
    Ok(FoldResult { cases, render })
}

#[tauri::command]
pub async fn mcp_fold_run(
    window: WebviewWindow,
    jobs: State<'_, Jobs>,
    id: String,
    document: CreasePatternDocument,
    starting_face: i32,
    case_limit: usize,
) -> Result<FoldResult, EngineError> {
    super::trusted(&window).map_err(|e| EngineError::new("access_denied", e))?;
    if !(1..=16).contains(&case_limit) || document.crease_pattern.line_segments.len() > 20_000 {
        return Err(EngineError::new(
            "resource_limit",
            "Fold request exceeds limits",
        ));
    }
    let stop = jobs
        .0
        .lock()
        .map_err(|_| EngineError::new("job_state", "Fold state unavailable"))?
        .get(&id)
        .cloned()
        .ok_or_else(|| EngineError::new("fold_cancelled", "Fold job is no longer available"))?;
    if stop.running.swap(true, Ordering::Relaxed) {
        return Err(EngineError::new("job_running", "Fold job already started"));
    }
    let result = tauri::async_runtime::spawn_blocking(move || {
        solve(document, starting_face, case_limit, stop)
    })
    .await
    .map_err(|_| EngineError::new("engine_task", "Isolated fold task failed"));
    if let Ok(mut active) = jobs.0.lock() {
        active.remove(&id);
    }
    result?
}

#[tauri::command]
pub fn mcp_fold_cancel(
    window: WebviewWindow,
    jobs: State<'_, Jobs>,
    id: String,
) -> Result<(), String> {
    super::trusted(&window)?;
    let mut active = jobs.0.lock().map_err(|_| "Fold state unavailable")?;
    if let Some(stop) = active.get(&id) {
        stop.cancelled.store(true, Ordering::Relaxed);
        if !stop.running.load(Ordering::Relaxed) {
            active.remove(&id);
        }
    }
    Ok(())
}
pub fn cancel_all(app: &AppHandle) {
    if let Some(jobs) = app.try_state::<Jobs>()
        && let Ok(mut active) = jobs.0.lock()
    {
        for stop in active.values() {
            stop.cancelled.store(true, Ordering::Relaxed);
        }
        active.retain(|_, stop| stop.running.load(Ordering::Relaxed));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cancellation_is_independent_for_each_native_experiment() {
        let one = Stop::new();
        let two = Stop::new();
        one.cancelled.store(true, Ordering::Relaxed);
        assert_eq!(one.cancelled_run(), 1);
        assert_eq!(two.cancelled_run(), 0);
    }
    #[test]
    fn native_deadline_survives_a_disappearing_renderer() {
        let stop = Stop {
            deadline: Instant::now() - Duration::from_secs(1),
            ..Stop::new()
        };
        assert_eq!(stop.cancelled_run(), 1);
    }
}
