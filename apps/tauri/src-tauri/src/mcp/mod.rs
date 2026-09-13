//! Desktop boundary only: authenticated loopback MCP, correlated renderer RPC.
//! Origami semantics and document transactions live in the shared application.
use axum::{
    body::{Body, to_bytes},
    extract::{Request, State as AxumState},
    http::StatusCode,
    middleware::{self, Next},
    response::{IntoResponse, Response},
};
use rmcp::{
    ErrorData, RoleServer, ServerHandler,
    model::{
        CallToolRequestParams, CallToolResult, Content, GetPromptRequestParams, GetPromptResult,
        Implementation, ListPromptsResult, ListResourcesResult, ListToolsResult,
        PaginatedRequestParams, ReadResourceRequestParams, ReadResourceResult, ServerCapabilities,
        ServerInfo, Tool,
    },
    service::RequestContext,
    transport::streamable_http_server::{
        StreamableHttpServerConfig, StreamableHttpService, session::local::LocalSessionManager,
    },
};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};
use tokio::sync::oneshot;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

pub mod folding;
pub mod guidance;

const MAX_BODY: usize = 8 * 1024 * 1024;
const MAX_PENDING: usize = 32;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub enabled: bool,
    pub endpoint: Option<String>,
    pub token: Option<String>,
    pub ready: bool,
}

struct Pending {
    generation: String,
    sender: oneshot::Sender<CallToolResult>,
}
#[derive(Default)]
struct Inner {
    status: Status,
    tools: Vec<Tool>,
    generation: String,
    pending: HashMap<String, Pending>,
    stop: Option<CancellationToken>,
}
#[derive(Clone, Default)]
pub struct McpState(Arc<Mutex<Inner>>, Arc<tokio::sync::Mutex<()>>);

// Also remove correlation slots when the transport drops a cancelled request
// future before its timeout. An abandoned client must not consume the queue.
struct PendingRequest(McpState, String);
impl Drop for PendingRequest {
    fn drop(&mut self) {
        if let Ok(mut inner) = self.0.0.lock() {
            inner.pending.remove(&self.1);
        }
    }
}

fn tool_error(code: &str, message: &str) -> CallToolResult {
    CallToolResult::error(vec![Content::text(
        serde_json::json!({"code": code, "message": message}).to_string(),
    )])
}
fn trusted(window: &WebviewWindow) -> Result<(), String> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err("MCP is owned by the main application window".into())
    }
}

#[derive(Clone)]
struct Handler {
    app: AppHandle,
    state: McpState,
}
impl ServerHandler for Handler {
    fn get_info(&self) -> ServerInfo {
        ServerInfo::new(
            ServerCapabilities::builder()
                .enable_prompts()
                .enable_resources()
                .enable_tools()
                .build(),
        )
        .with_server_info(Implementation::new("ori-studio", env!("CARGO_PKG_VERSION")))
        .with_instructions("Autonomous origami workflow: workspace → begin_design → inspect_design → edit → analyze_design/simulate_design → job_status → render_view → repair → export_design → commit_design. Experiments are isolated. Quote exact revisions and unique mutation request_id values. Retry lost responses with identical arguments and IDs. No host execution or filesystem access. Read the prompt `origami-workflow` for the operating rules, and the resource `ori-studio://guide/diagnostics` before interpreting analyze_design results; `ori-studio://guide/recipes` and `ori-studio://guide/knowledge` hold the workflows and the reference behind them.")
    }
    // Guidance is static text compiled from `docs/`; it never touches the
    // renderer, so it is answered here without the `ready`/`enabled` gate that
    // tool calls need.
    async fn list_prompts(
        &self,
        _: Option<PaginatedRequestParams>,
        _: RequestContext<RoleServer>,
    ) -> Result<ListPromptsResult, ErrorData> {
        Ok(ListPromptsResult::with_all_items(guidance::prompt_list()))
    }
    async fn get_prompt(
        &self,
        request: GetPromptRequestParams,
        _: RequestContext<RoleServer>,
    ) -> Result<GetPromptResult, ErrorData> {
        guidance::prompt(&request.name).ok_or_else(|| {
            ErrorData::invalid_params(format!("unknown prompt: {}", request.name), None)
        })
    }
    async fn list_resources(
        &self,
        _: Option<PaginatedRequestParams>,
        _: RequestContext<RoleServer>,
    ) -> Result<ListResourcesResult, ErrorData> {
        Ok(ListResourcesResult::with_all_items(
            guidance::resource_list(),
        ))
    }
    async fn read_resource(
        &self,
        request: ReadResourceRequestParams,
        _: RequestContext<RoleServer>,
    ) -> Result<ReadResourceResult, ErrorData> {
        guidance::read_resource(&request.uri).ok_or_else(|| {
            ErrorData::resource_not_found(format!("unknown resource: {}", request.uri), None)
        })
    }
    async fn list_tools(
        &self,
        _: Option<PaginatedRequestParams>,
        _: RequestContext<RoleServer>,
    ) -> Result<ListToolsResult, ErrorData> {
        let tools = self
            .state
            .0
            .lock()
            .map_err(|_| ErrorData::internal_error("MCP state unavailable", None))?
            .tools
            .clone();
        Ok(ListToolsResult::with_all_items(tools))
    }
    async fn call_tool(
        &self,
        request: CallToolRequestParams,
        _: RequestContext<RoleServer>,
    ) -> Result<CallToolResult, ErrorData> {
        let id = Uuid::new_v4().to_string();
        let (tx, rx) = oneshot::channel();
        let generation = {
            let mut inner = self
                .state
                .0
                .lock()
                .map_err(|_| ErrorData::internal_error("MCP state unavailable", None))?;
            if !inner.status.enabled || !inner.status.ready {
                return Ok(tool_error(
                    "not_ready",
                    "Desktop renderer is unavailable; reconnect after it is ready",
                ));
            }
            if !inner.tools.iter().any(|tool| tool.name == request.name) {
                return Ok(tool_error("unknown_tool", "Unknown tool"));
            }
            if inner.pending.len() >= MAX_PENDING {
                return Ok(tool_error("busy", "Too many pending requests; retry later"));
            }
            let generation = inner.generation.clone();
            inner.pending.insert(
                id.clone(),
                Pending {
                    generation: generation.clone(),
                    sender: tx,
                },
            );
            generation
        };
        let _pending = PendingRequest(self.state.clone(), id.clone());
        let payload = serde_json::json!({ "id": id, "generation": generation, "name": request.name, "arguments": request.arguments.unwrap_or_default() });
        if self.app.emit_to("main", "mcp-request", payload).is_err() {
            if let Ok(mut inner) = self.state.0.lock() {
                inner.pending.remove(&id);
            }
            return Ok(tool_error("not_ready", "Cannot reach desktop renderer"));
        }
        let response = tokio::time::timeout(REQUEST_TIMEOUT, rx).await;
        if let Ok(mut inner) = self.state.0.lock() {
            inner.pending.remove(&id);
        }
        Ok(match response {
            Ok(Ok(value)) => value,
            Ok(Err(_)) => tool_error(
                "disconnected",
                "Renderer or server restarted; inspect the workspace before continuing",
            ),
            Err(_) => tool_error(
                "response_timeout",
                "Response not received in 30 seconds. Outcome may be pending; retry identical mutation arguments/request_id to retrieve its receipt. Do not repeat with a new ID.",
            ),
        })
    }
}

#[derive(Clone)]
struct Gate {
    token: String,
    authority: String,
    stop: CancellationToken,
}

fn authorized(headers: &axum::http::HeaderMap, gate: &Gate) -> Result<(), StatusCode> {
    if gate.stop.is_cancelled() {
        return Err(StatusCode::SERVICE_UNAVAILABLE);
    }
    // No browser origin is granted access, including null and localhost. MCP
    // clients do not need CORS; rejecting Origin prevents websites using the API.
    if headers.contains_key("origin") {
        return Err(StatusCode::FORBIDDEN);
    }
    if headers.get("host").and_then(|v| v.to_str().ok()) != Some(&gate.authority) {
        return Err(StatusCode::FORBIDDEN);
    }
    let expected = format!("Bearer {}", gate.token);
    let supplied = headers
        .get("authorization")
        .map(|v| v.as_bytes())
        .unwrap_or_default();
    let difference = supplied
        .iter()
        .zip(expected.as_bytes())
        .fold(0_u8, |d, (a, b)| d | (a ^ b));
    if supplied.len() != expected.len() || difference != 0 {
        return Err(StatusCode::UNAUTHORIZED);
    }
    Ok(())
}
async fn guard(AxumState(gate): AxumState<Gate>, request: Request, next: Next) -> Response {
    if let Err(status) = authorized(request.headers(), &gate) {
        return status.into_response();
    }
    let (parts, body) = request.into_parts();
    let bytes = match tokio::time::timeout(Duration::from_secs(10), to_bytes(body, MAX_BODY)).await
    {
        Ok(Ok(bytes)) => bytes,
        Ok(Err(_)) => return StatusCode::PAYLOAD_TOO_LARGE.into_response(),
        Err(_) => return StatusCode::REQUEST_TIMEOUT.into_response(),
    };
    next.run(Request::from_parts(parts, Body::from(bytes)))
        .await
}

async fn configure(
    app: &AppHandle,
    state: &McpState,
    enabled: bool,
    port: u16,
) -> Result<Status, String> {
    let _configuration = state.1.lock().await;
    folding::cancel_all(app);
    {
        let mut inner = state.0.lock().map_err(|_| "MCP state unavailable")?;
        if let Some(stop) = inner.stop.take() {
            stop.cancel();
        }
        inner.status.enabled = false;
        inner.status.endpoint = None;
        inner.status.token = None;
        inner.pending.clear();
    }
    if !enabled {
        let _ = app.emit_to("main", "mcp-disabled", ());
        return status(state);
    }
    let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, port))
        .await
        .map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let token = std::env::var("ORI_MCP_TOKEN")
        .ok()
        .filter(|s| {
            s.len() >= 32
                && s.len() <= 256
                && s.bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
        })
        .unwrap_or_else(|| format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple()));
    let stop = CancellationToken::new();
    let authority = format!("127.0.0.1:{port}");
    let gate = Gate {
        token: token.clone(),
        authority: authority.clone(),
        stop: stop.clone(),
    };
    let handler = Handler {
        app: app.clone(),
        state: state.clone(),
    };
    // Stateless MCP prevents abandoned clients accumulating transport sessions.
    // Revisioned experiments and receipts are explicit application resources.
    let service = StreamableHttpService::new(
        move || Ok(handler.clone()),
        Arc::new(LocalSessionManager::default()),
        StreamableHttpServerConfig::default()
            .with_stateful_mode(false)
            .with_json_response(true)
            .with_allowed_hosts(vec![authority.clone()])
            .with_cancellation_token(stop.clone()),
    );
    let router = axum::Router::new()
        .nest_service("/mcp", service)
        .layer(middleware::from_fn_with_state(gate, guard));
    let stopping = stop.clone();
    tokio::spawn(async move {
        if let Err(error) = axum::serve(listener, router)
            .with_graceful_shutdown(async move {
                stopping.cancelled().await;
            })
            .await
        {
            eprintln!("Ori Studio MCP server stopped: {error}");
        }
    });
    let mut inner = state.0.lock().map_err(|_| "MCP state unavailable")?;
    inner.stop = Some(stop);
    inner.status.enabled = true;
    inner.status.endpoint = Some(format!("http://{authority}/mcp"));
    inner.status.token = Some(token);
    Ok(inner.status.clone())
}
fn status(state: &McpState) -> Result<Status, String> {
    Ok(state
        .0
        .lock()
        .map_err(|_| "MCP state unavailable")?
        .status
        .clone())
}

#[tauri::command]
pub async fn mcp_configure(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, McpState>,
    enabled: bool,
) -> Result<Status, String> {
    trusted(&window)?;
    configure(&app, &state, enabled, 0).await
}
#[tauri::command]
pub fn mcp_status(window: WebviewWindow, state: State<'_, McpState>) -> Result<Status, String> {
    trusted(&window)?;
    status(&state)
}
#[tauri::command]
pub async fn mcp_ready(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, McpState>,
    tools: Vec<Tool>,
    generation: String,
) -> Result<Status, String> {
    trusted(&window)?;
    if tools.len() > 64 {
        return Err("Too many tools".into());
    }
    let auto_enable = {
        let mut inner = state.0.lock().map_err(|_| "MCP state unavailable")?;
        let first = inner.generation.is_empty();
        inner.pending.clear();
        inner.tools = tools;
        inner.generation = generation;
        inner.status.ready = true;
        first && !inner.status.enabled
    };
    if auto_enable && let Ok(port) = std::env::var("ORI_MCP_PORT") {
        return configure(
            &app,
            &state,
            true,
            port.parse().map_err(|_| "ORI_MCP_PORT must be 0..65535")?,
        )
        .await;
    }
    status(&state)
}
#[derive(Deserialize)]
pub struct Reply {
    id: String,
    generation: String,
    result: CallToolResult,
}
#[tauri::command]
pub fn mcp_reply(
    window: WebviewWindow,
    state: State<'_, McpState>,
    reply: Reply,
) -> Result<(), String> {
    trusted(&window)?;
    let mut inner = state.0.lock().map_err(|_| "MCP state unavailable")?;
    if inner
        .pending
        .get(&reply.id)
        .is_some_and(|p| p.generation == reply.generation)
        && let Some(pending) = inner.pending.remove(&reply.id)
    {
        let _ = pending.sender.send(reply.result);
    }
    Ok(())
}

pub fn renderer_loading(app: &AppHandle) {
    folding::cancel_all(app);
    if let Some(state) = app.try_state::<McpState>()
        && let Ok(mut inner) = state.0.lock()
    {
        inner.status.ready = false;
        inner.pending.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn abandoning_a_request_releases_its_correlation_slot() {
        let state = McpState::default();
        let (sender, mut receiver) = oneshot::channel();
        state.0.lock().unwrap().pending.insert(
            "request".into(),
            Pending {
                generation: "generation".into(),
                sender,
            },
        );
        drop(PendingRequest(state.clone(), "request".into()));
        assert!(state.0.lock().unwrap().pending.is_empty());
        assert!(matches!(
            receiver.try_recv(),
            Err(oneshot::error::TryRecvError::Closed)
        ));
    }
    #[test]
    fn loopback_does_not_replace_authentication_or_origin_checks() {
        let gate = Gate {
            token: "a".repeat(64),
            authority: "127.0.0.1:32124".into(),
            stop: CancellationToken::new(),
        };
        let mut h = axum::http::HeaderMap::new();
        h.insert("host", gate.authority.parse().unwrap());
        assert_eq!(authorized(&h, &gate), Err(StatusCode::UNAUTHORIZED));
        h.insert(
            "authorization",
            format!("Bearer {}", gate.token).parse().unwrap(),
        );
        assert_eq!(authorized(&h, &gate), Ok(()));
        for origin in ["https://evil.example", "http://127.0.0.1:32124", "null"] {
            h.insert("origin", origin.parse().unwrap());
            assert_eq!(authorized(&h, &gate), Err(StatusCode::FORBIDDEN));
        }
        h.remove("origin");
        h.insert("host", "evil.example:32124".parse().unwrap());
        assert_eq!(authorized(&h, &gate), Err(StatusCode::FORBIDDEN));
        h.insert("host", gate.authority.parse().unwrap());
        gate.stop.cancel();
        assert_eq!(authorized(&h, &gate), Err(StatusCode::SERVICE_UNAVAILABLE));
    }
}
