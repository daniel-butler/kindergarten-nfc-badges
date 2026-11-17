mod ids;
mod registry;
mod taps;

use std::convert::Infallible;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use axum::extract::State;
use axum::http::{StatusCode, Uri, header};
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use rust_embed::RustEmbed;
use serde::Deserialize;
use tokio::sync::broadcast;
use tokio_stream::Stream;
use tokio_stream::StreamExt;
use tokio_stream::wrappers::BroadcastStream;

use registry::{Card, Registry};
use taps::{Linker, Source, TapEvent};

#[derive(RustEmbed)]
#[folder = "static/"]
struct Assets;

#[derive(Clone)]
enum Broadcast {
    Tap(TapEvent),
    Cards(Vec<Card>),
}

struct Inner {
    registry: Registry,
    linker: Linker,
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
        let Inner { registry, linker } = &mut *inner;
        let (card, linked) = linker.handle(registry, &canonical_id, req.source, Instant::now());
        let event = TapEvent {
            raw_id: req.id,
            canonical_id,
            source: req.source,
            card,
            ts: now_ms(),
            linked,
        };
        (event, linked.then(|| registry.cards().to_vec()))
    };
    if let Some(cards) = cards {
        let _ = state.tx.send(Broadcast::Cards(cards));
    }
    let _ = state.tx.send(Broadcast::Tap(event.clone()));
    Ok(Json(event))
}

async fn events(
    State(state): State<AppState>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let stream = BroadcastStream::new(state.tx.subscribe()).filter_map(|msg| {
        let event = match msg.ok()? {
            Broadcast::Tap(t) => Event::default().event("tap").json_data(t),
            Broadcast::Cards(c) => Event::default().event("cards").json_data(c),
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
        })),
        tx,
    };
    let app = Router::new()
        .route("/tap", post(tap))
        .route("/events", get(events))
        .route("/api/cards", get(get_cards).put(put_cards))
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
