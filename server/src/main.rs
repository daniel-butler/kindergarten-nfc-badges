mod ids;
mod presenter;
mod registry;
mod taps;

use std::convert::Infallible;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use axum::body::Bytes;
use axum::extract::{DefaultBodyLimit, Path, Query, State};
use axum::http::{StatusCode, Uri, header};
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post, put};
use axum::{Json, Router};
use rust_embed::RustEmbed;
use serde::Deserialize;
use tokio::sync::broadcast;
use tokio_stream::Stream;
use tokio_stream::StreamExt;
use tokio_stream::wrappers::BroadcastStream;

use presenter::{PresenterState, parse_command};
use registry::{Card, ImageError, MAX_IMAGE_BYTES, Registry};
use taps::{Linker, Source, TapEvent};

#[derive(RustEmbed)]
#[folder = "static/"]
struct Assets;

#[derive(Clone)]
enum Broadcast {
    Tap(Box<TapEvent>),
    Cards(Vec<Card>),
    Command(&'static str),
}

struct Inner {
    registry: Registry,
    linker: Linker,
    presenter: PresenterState,
}

#[derive(Clone)]
struct AppState {
    inner: Arc<Mutex<Inner>>,
    tx: broadcast::Sender<Broadcast>,
}

type ApiError = (StatusCode, String);

#[derive(Deserialize)]
struct TapRequest {
    id: String,
    source: Source,
}

#[derive(serde::Serialize, Deserialize)]
struct LinkMode {
    enabled: bool,
}

async fn tap(
    State(state): State<AppState>,
    Json(req): Json<TapRequest>,
) -> Result<Json<TapEvent>, ApiError> {
    let canonical_id = ids::normalize(&req.id).ok_or_else(|| {
        (
            StatusCode::BAD_REQUEST,
            format!("not a hex id: {:?}", req.id),
        )
    })?;
    let (event, cards) = {
        let mut inner = state.inner.lock().unwrap();
        let Inner {
            registry,
            linker,
            presenter,
        } = &mut *inner;
        let outcome = linker.handle(registry, &canonical_id, req.source, Instant::now());
        presenter.observe(&req.id, outcome.card.as_ref(), now_ms());
        let event = TapEvent {
            raw_id: req.id,
            canonical_id,
            source: req.source,
            card: outcome.card,
            ts: now_ms(),
            linked: outcome.linked,
        };
        (
            event,
            outcome.cards_changed.then(|| registry.cards().to_vec()),
        )
    };
    if let Some(cards) = cards {
        let _ = state.tx.send(Broadcast::Cards(cards));
    }
    let _ = state.tx.send(Broadcast::Tap(Box::new(event.clone())));
    Ok(Json(event))
}

async fn events(
    State(state): State<AppState>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let stream = BroadcastStream::new(state.tx.subscribe()).filter_map(|msg| {
        let event = match msg.ok()? {
            Broadcast::Tap(t) => Event::default().event("tap").json_data(t),
            Broadcast::Cards(c) => Event::default().event("cards").json_data(c),
            Broadcast::Command(action) => Event::default()
                .event("command")
                .json_data(serde_json::json!({ "action": action })),
        };
        event.ok().map(Ok)
    });
    Sse::new(stream).keep_alive(KeepAlive::default())
}

async fn get_cards(State(state): State<AppState>) -> Json<Vec<Card>> {
    Json(state.inner.lock().unwrap().registry.cards().to_vec())
}

async fn put_cards(
    State(state): State<AppState>,
    Json(cards): Json<Vec<Card>>,
) -> Result<Json<Vec<Card>>, ApiError> {
    let cards = {
        let mut inner = state.inner.lock().unwrap();
        inner
            .registry
            .replace(cards)
            .map_err(|e| (StatusCode::CONFLICT, e))?;
        inner.registry.cards().to_vec()
    };
    let _ = state.tx.send(Broadcast::Cards(cards.clone()));
    Ok(Json(cards))
}

/// Run a registry change and broadcast the new card list if it succeeded.
fn mutate<T>(
    state: &AppState,
    change: impl FnOnce(&mut Registry) -> Result<T, ApiError>,
) -> Result<T, ApiError> {
    let (value, cards) = {
        let mut inner = state.inner.lock().unwrap();
        let value = change(&mut inner.registry)?;
        (value, inner.registry.cards().to_vec())
    };
    let _ = state.tx.send(Broadcast::Cards(cards));
    Ok(value)
}

async fn upsert_card(
    State(state): State<AppState>,
    Json(card): Json<Card>,
) -> Result<Json<Card>, ApiError> {
    mutate(&state, |reg| {
        reg.upsert(card).map_err(|e| (StatusCode::CONFLICT, e))
    })
    .map(Json)
}

#[derive(Deserialize)]
struct ResolveQuery {
    id: String,
}

#[derive(serde::Serialize)]
struct ResolveResponse {
    canonical_id: String,
    card: Option<Card>,
}

async fn resolve_card(
    State(state): State<AppState>,
    Query(q): Query<ResolveQuery>,
) -> Result<Json<ResolveResponse>, ApiError> {
    let canonical_id = ids::normalize(&q.id)
        .ok_or_else(|| (StatusCode::BAD_REQUEST, format!("not a hex id: {:?}", q.id)))?;
    let card = state
        .inner
        .lock()
        .unwrap()
        .registry
        .resolve(&canonical_id)
        .cloned();
    Ok(Json(ResolveResponse { canonical_id, card }))
}

async fn put_card_image(
    State(state): State<AppState>,
    Path(id): Path<String>,
    body: Bytes,
) -> Result<Json<Card>, ApiError> {
    let id = ids::normalize(&id).ok_or((StatusCode::NOT_FOUND, "no such card".to_string()))?;
    mutate(&state, |reg| {
        reg.set_image(&id, &body, now_ms()).map_err(|e| match e {
            ImageError::NotFound => (StatusCode::NOT_FOUND, format!("no card {id}")),
            ImageError::NotPng => (
                StatusCode::UNSUPPORTED_MEDIA_TYPE,
                "image must be a PNG".to_string(),
            ),
            ImageError::TooLarge => (
                StatusCode::PAYLOAD_TOO_LARGE,
                "image is over 5 MB".to_string(),
            ),
            ImageError::Io(e) => (StatusCode::INTERNAL_SERVER_ERROR, e),
        })
    })
    .map(Json)
}

async fn get_presenter(State(state): State<AppState>) -> Json<PresenterState> {
    Json(state.inner.lock().unwrap().presenter.clone())
}

#[derive(Deserialize)]
struct CommandRequest {
    action: String,
}

/// A key press or a phone button: apply the server's part, then tell the page.
async fn command(
    State(state): State<AppState>,
    Json(req): Json<CommandRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let action = parse_command(&req.action).ok_or_else(|| {
        (
            StatusCode::BAD_REQUEST,
            format!("unknown command {:?}", req.action),
        )
    })?;
    let cards = {
        let mut inner = state.inner.lock().unwrap();
        match action {
            "allow-special" | "reset" => {
                inner
                    .registry
                    .set_allowed_for_specials(action == "allow-special")
                    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;
                if action == "reset" {
                    inner.presenter = PresenterState::default();
                }
                Some(inner.registry.cards().to_vec())
            }
            "let-in" | "keep-out" => {
                inner.presenter.clear_trick();
                None
            }
            _ => None,
        }
    };
    if let Some(cards) = cards {
        let _ = state.tx.send(Broadcast::Cards(cards));
    }
    let _ = state.tx.send(Broadcast::Command(action));
    Ok(Json(serde_json::json!({ "ok": true })))
}

async fn clear_away(State(state): State<AppState>) -> Result<Json<Vec<Card>>, ApiError> {
    mutate(&state, |reg| {
        reg.clear_away()
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;
        Ok(reg.cards().to_vec())
    })
    .map(Json)
}

/// Serves sticker cutouts. Only `<HEX>.png` names, so nothing else on disk is reachable.
async fn get_image(State(state): State<AppState>, Path(file): Path<String>) -> Response {
    let valid = file.strip_suffix(".png").is_some_and(|name| {
        !name.is_empty()
            && name
                .chars()
                .all(|c| c.is_ascii_digit() || ('A'..='F').contains(&c))
    });
    if !valid {
        return (StatusCode::NOT_FOUND, "not found").into_response();
    }
    let dir = state.inner.lock().unwrap().registry.images_dir();
    match tokio::fs::read(dir.join(&file)).await {
        Ok(bytes) => (
            [
                (header::CONTENT_TYPE, "image/png"),
                (header::CACHE_CONTROL, "public, max-age=31536000, immutable"),
            ],
            bytes,
        )
            .into_response(),
        Err(_) => (StatusCode::NOT_FOUND, "not found").into_response(),
    }
}

async fn get_link_mode(State(state): State<AppState>) -> Json<LinkMode> {
    Json(LinkMode {
        enabled: state.inner.lock().unwrap().linker.enabled(),
    })
}

async fn put_link_mode(
    State(state): State<AppState>,
    Json(mode): Json<LinkMode>,
) -> Json<LinkMode> {
    state.inner.lock().unwrap().linker.set_enabled(mode.enabled);
    Json(mode)
}

async fn static_file(uri: Uri) -> Response {
    let path = match uri.path().trim_start_matches('/') {
        "" => "index.html",
        p => p,
    };
    match Assets::get(path) {
        Some(file) => (
            [
                (header::CONTENT_TYPE, file.metadata.mimetype().to_string()),
                (header::CACHE_CONTROL, "no-cache".to_string()),
            ],
            file.data,
        )
            .into_response(),
        None => (StatusCode::NOT_FOUND, "not found").into_response(),
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as u64)
}

struct Config {
    addr: SocketAddr,
    cards: PathBuf,
}

const USAGE: &str =
    "usage: badge-server [--bind 0.0.0.0] [--port 8080] [--cards path/to/cards.json]";

fn parse_args() -> Result<Config, String> {
    let mut host = "0.0.0.0".to_string();
    let mut port: u16 = 8080;
    let mut cards = None;
    let mut args = std::env::args().skip(1);
    while let Some(flag) = args.next() {
        let mut value = || {
            args.next()
                .ok_or_else(|| format!("{flag} needs a value\n{USAGE}"))
        };
        match flag.as_str() {
            "--bind" => host = value()?,
            "--port" => port = value()?.parse().map_err(|e| format!("bad --port: {e}"))?,
            "--cards" => cards = Some(PathBuf::from(value()?)),
            "-h" | "--help" => return Err(USAGE.to_string()),
            other => return Err(format!("unknown argument {other}\n{USAGE}")),
        }
    }
    let addr = format!("{host}:{port}")
        .parse()
        .map_err(|e| format!("bad bind address: {e}"))?;
    let cards = match cards {
        Some(p) => p,
        None => std::env::current_exe()
            .map_err(|e| e.to_string())?
            .with_file_name("cards.json"),
    };
    Ok(Config { addr, cards })
}

fn print_urls(port: u16) {
    println!("Projector page:  http://localhost:{port}/");
    let ips: Vec<_> = if_addrs::get_if_addrs()
        .unwrap_or_default()
        .into_iter()
        .filter(|i| !i.is_loopback() && i.ip().is_ipv4())
        .collect();
    if ips.is_empty() {
        println!("No LAN IPv4 address found. Is the Mac on the hotspot?");
    }
    for iface in ips {
        println!(
            "Phone app URL:   http://{}:{port}   ({})",
            iface.ip(),
            iface.name
        );
    }
}

#[tokio::main]
async fn main() {
    let config = parse_args().unwrap_or_else(|e| {
        eprintln!("{e}");
        std::process::exit(2);
    });
    let registry = Registry::load(config.cards).unwrap_or_else(|e| {
        eprintln!("{e}");
        std::process::exit(1);
    });
    println!(
        "Cards file:      {} ({} cards)",
        registry.path().display(),
        registry.cards().len()
    );

    let (tx, _) = broadcast::channel(256);
    let state = AppState {
        inner: Arc::new(Mutex::new(Inner {
            registry,
            linker: Linker::default(),
            presenter: PresenterState::default(),
        })),
        tx,
    };
    let app = Router::new()
        .route("/tap", post(tap))
        .route("/events", get(events))
        .route(
            "/api/cards",
            get(get_cards).put(put_cards).post(upsert_card),
        )
        .route("/api/cards/resolve", get(resolve_card))
        .route("/api/cards/clear-away", post(clear_away))
        .route("/api/presenter", get(get_presenter))
        .route("/api/command", post(command))
        .route(
            "/api/cards/{id}/image",
            put(put_card_image).layer(DefaultBodyLimit::max(MAX_IMAGE_BYTES + 1024)),
        )
        .route("/images/{file}", get(get_image))
        .route("/api/link-mode", get(get_link_mode).put(put_link_mode))
        .fallback(static_file)
        .with_state(state);

    let listener = tokio::net::TcpListener::bind(config.addr)
        .await
        .unwrap_or_else(|e| {
            eprintln!("cannot bind {}: {e}", config.addr);
            std::process::exit(1);
        });
    println!("Listening on     {}", config.addr);
    print_urls(config.addr.port());
    axum::serve(listener, app).await.unwrap();
}
