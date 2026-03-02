use std::time::Duration;

use rand::Rng;
use spacetimedb::{
    Identity, ReducerContext, ScheduleAt, SpacetimeType, Table, Timestamp, ViewContext, reducer, table, view
};

use crate::countries::Iso3166Alpha2;

mod countries;

const TOTAL_STEPS: u32 = 20;
const PASSIVE_DECAY: i32 = 17;
const MIASMA_PENALTY: i32 = -20;
const RELEVANCE_BONUS: i32 = 10;
const INITIAL_STABILITY: i32 = 100;

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

#[derive(PartialEq, Eq, Clone)]
#[table(accessor = message, private)]
pub struct Message {
    #[primary_key]
    #[auto_inc]
    pub message_id: u64,
    pub text: String,
    pub sender: Identity,
    pub sent: Timestamp,
    pub location: Iso3166Alpha2,
}

#[table(accessor = active_session, private, index(accessor = by_user, btree(columns = [initiator])))]
pub struct ActiveSession {
    #[primary_key]
    #[auto_inc]
    pub seance_id: u64,
    pub initiator: Identity,
    pub finished_seance_ref: u64,
    pub ghost_messages: Vec<u64>,
    pub initiator_messages: Vec<u64>,
    pub current_steps: u32,
    pub state: SessionState,
    pub initiated_on: Timestamp,
}

#[derive(SpacetimeType, PartialEq, Eq, Clone, Copy)]
pub enum SessionState {
    WaitingForInitiator,
    GhostWriting,
    Idle,
}

#[table(accessor = start_ghost_write, private, scheduled(start_ghost_writing))]
pub struct StartGhostWriting {
    #[primary_key]
    #[auto_inc]
    pub seance_id: u64,
    pub scheduled_at: ScheduleAt,
}

#[table(accessor = send_ghost_message, private, scheduled(send_ghost_message_red))]
pub struct SendGhostMessage {
    #[primary_key]
    #[auto_inc]
    pub seance_id: u64,
    pub scheduled_at: ScheduleAt,
}

#[table(accessor = finished_session, private, index(accessor = by_user, btree(columns = [initiator])))]
pub struct FinishedSession {
    #[primary_key]
    #[auto_inc]
    pub seance_id: u64,
    pub initiator: Identity,
    pub ghost_messages: Vec<u64>,
    pub initiator_messages: Vec<u64>,
    pub total_steps: u32,
    pub initiated_on: Timestamp,
    pub finished_on: Timestamp,
}

// ---------------------------------------------------------------------------
// Helpers: stability (deterministic, no network)
// ---------------------------------------------------------------------------

fn is_vowel(c: char) -> bool {
    "aeiouAEIOU".contains(c)
}

fn consecutive_consonants(word: &str) -> usize {
    let mut max = 0usize;
    let mut cur = 0usize;
    for c in word.chars() {
        if c.is_alphabetic() && !is_vowel(c) {
            cur += 1;
            max = max.max(cur);
        } else {
            cur = 0;
        }
    }
    max
}

fn is_miasma_word(word: &str) -> bool {
    if word.len() > 15 && !word.chars().any(is_vowel) {
        return true;
    }
    consecutive_consonants(word) > 5
}

fn word_prefix(s: &str, len: usize) -> String {
    s.chars().take(len).collect::<String>()
}

fn words_match(a: &str, b: &str) -> bool {
    let pa = word_prefix(a, 4);
    let pb = word_prefix(b, 4);
    if pa.is_empty() || pb.is_empty() {
        return false;
    }
    pa.eq_ignore_ascii_case(&pb)
}

fn relevance_bonus(ghost_text: &str, user_text: &str) -> i32 {
    let ghost_words: Vec<&str> = ghost_text.split_whitespace().collect();
    let user_words: Vec<&str> = user_text.split_whitespace().collect();
    let mut bonus = 0i32;
    for uw in &user_words {
        for gw in &ghost_words {
            if words_match(uw, gw) {
                bonus += RELEVANCE_BONUS;
                break;
            }
        }
    }
    bonus
}

fn miasma_penalty(text: &str) -> i32 {
    let mut penalty = 0i32;
    for word in text.split_whitespace() {
        if is_miasma_word(word) {
            penalty += MIASMA_PENALTY;
        }
    }
    penalty
}

// ---------------------------------------------------------------------------
// Logging helpers
// ---------------------------------------------------------------------------

/// Short identity for logs (e.g. "a1b2c3d4").
fn log_identity(id: &Identity) -> String {
    id.to_hex().to_string().chars().take(8).collect::<String>()
}

// ---------------------------------------------------------------------------
// Reducers
// ---------------------------------------------------------------------------

#[reducer(init)]
pub fn init(ctx: &ReducerContext) {
    let seed_messages = [
        "The veil grows thin tonight.",
        "Whispers echo in the candle light.",
        "Who calls into the darkness?",
        "The spirits draw near.",
        "Not all who wander are lost.",
        "Your words ripple through the ether.",
        "Some secrets are best left unspoken.",
        "Do you seek wisdom or warning?",
        "The past yearns to be known.",
        "All things return in time.",
        "Voices from beyond watch in silence.",
        "Ask, and the shadows may answer.",
        "The circle is unbroken.",
        "Silence sometimes speaks louder.",
        "What will you sacrifice for knowledge?",
        "Even echoes tire of waiting.",
        "Listen. A presence lingers.",
        "In darkness, truth reveals itself.",
        "Do not fear what you cannot see.",
        "The ritual has begun.",
    ];

    let _finished_session = ctx.db.finished_session().insert(FinishedSession {
        seance_id: 0,
        initiator: ctx.sender(),
        ghost_messages: (0..seed_messages.len()).map(|_| ctx.db.message().insert(Message {
            message_id: 0,
            text: "".to_string(),
            sender: ctx.sender(),
            sent: ctx.timestamp,
            location: Iso3166Alpha2::AT,
        }).message_id).collect(),
        initiator_messages: seed_messages.map(|text| ctx.db.message().insert(Message {
            message_id: 0,
            text: text.to_string(),
            sender: ctx.sender(),
            sent: ctx.timestamp,
            location: Iso3166Alpha2::AT,
        }).message_id).to_vec(),
        total_steps: seed_messages.len() as u32,
        initiated_on: ctx.timestamp,
        finished_on: ctx.timestamp,
    });

    log::info!(
        "[init] Seed session created: {} ghost steps, initiator={}",
        seed_messages.len(),
        log_identity(&ctx.sender())
    );
}

#[reducer(client_connected)]
pub fn identity_connected(ctx: &ReducerContext) -> Result<(), String> {
    log::info!("[connect] Client connected identity={}", log_identity(&ctx.sender()));
    start_new_session(ctx)?;
    Ok(())
}

#[reducer(client_disconnected)]
pub fn identity_disconnected(ctx: &ReducerContext) -> Result<(), String> {
    log::info!("[disconnect] Client disconnected identity={}", log_identity(&ctx.sender()));
    cancel_active_sessions_user(ctx)?;
    Ok(())
}

#[reducer]
pub fn start_ghost_writing(ctx: &ReducerContext, row: StartGhostWriting) -> Result<(), String> {
    log::debug!("[ghost_write] Scheduled job started seance_id={}", row.seance_id);
    if ctx.connection_id().is_some() {
        return Err("Can run only scheduled reducer".into());
    }

    let mut active_session = ctx
        .db
        .active_session()
        .seance_id()
        .find(row.seance_id)
        .ok_or("Active session not found")?;
    if active_session.state != SessionState::Idle {
        return Err("Active session is not idle".to_string());
    }
    active_session.state = SessionState::GhostWriting;
    ctx.db.active_session().seance_id().update(active_session);
    log::info!("[ghost_write] seance_id={} state=GhostWriting (ghost typing)", row.seance_id);
    ctx.db.send_ghost_message().insert(SendGhostMessage {
        seance_id: row.seance_id,
        scheduled_at: ScheduleAt::Time(
            ctx.timestamp + Duration::from_secs(ctx.rng().gen_range(3..7)),
        ),
    });
    Ok(())
}

#[reducer]
pub fn send_ghost_message_red(ctx: &ReducerContext, row: SendGhostMessage) -> Result<(), String> {
    log::debug!("[ghost_send] Scheduled job started seance_id={}", row.seance_id);
    if ctx.connection_id().is_some() {
        log::error!("[ghost_send] Rejected: must be run by scheduler only");
        return Err("Can run only scheduled reducer".into());
    }
    let mut active_session = ctx
        .db
        .active_session()
        .seance_id()
        .find(row.seance_id)
        .ok_or("Active session not found")?;
    if active_session.state != SessionState::GhostWriting {
        return Err("Active session is not ghost writing".to_string());
    }
    active_session.state = SessionState::WaitingForInitiator;
    let reference_session = ctx
        .db
        .finished_session()
        .seance_id()
        .find(active_session.finished_seance_ref)
        .ok_or("Reference session not found")?;
    let our_ghost_messages = reference_session.initiator_messages;
    let next_step = active_session.current_steps + 1;
    let next_ghost_message = our_ghost_messages
        .get(next_step as usize)
        .ok_or("Next ghost message not found")?;
    let ghost_text = ctx
        .db
        .message()
        .message_id()
        .find(next_ghost_message)
        .map(|m| m.text.clone())
        .unwrap_or_else(|| "?".to_string());
    active_session.ghost_messages.push(*next_ghost_message);
    active_session.current_steps = next_step;
    ctx.db.active_session().seance_id().update(active_session);
    log::info!(
        "[ghost_send] seance_id={} step={}/{} text=\"{}\"",
        row.seance_id,
        next_step,
        reference_session.total_steps,
        ghost_text
    );
    Ok(())
}

#[reducer]
pub fn cancel_active_sessions_user(ctx: &ReducerContext) -> Result<(), String> {
    let count = ctx.db.active_session().by_user().filter(&ctx.sender()).count();
    ctx.db.active_session().by_user().delete(ctx.sender());
    if count > 0 {
        log::info!(
            "[cancel] Dropped {} active session(s) identity={}",
            count,
            log_identity(&ctx.sender())
        );
    }
    Ok(())
}

#[reducer]
pub fn start_new_session(ctx: &ReducerContext) -> Result<(), String> {
    cancel_active_sessions_user(ctx)?;

    // Find reference session
    let reference_sessions = ctx
        .db
        .finished_session()
        .iter()
        .filter(|s| s.initiator != ctx.sender())
        .collect::<Vec<_>>();
    log::debug!(
        "[session] {} reference session(s) available for identity={}",
        reference_sessions.len(),
        log_identity(&ctx.sender())
    );
    if reference_sessions.is_empty() {
        log::error!(
            "[session] No reference sessions for identity={} (need at least one other finished session)",
            log_identity(&ctx.sender())
        );
        return Err("No available reference sessions".to_string());
    }
    let idx = ctx.rng().gen_range(0..reference_sessions.len());
    let reference_session = &reference_sessions[idx];

    // Create new session
    let new_session = ctx.db.active_session().insert(ActiveSession {
        seance_id: 0,
        initiator: ctx.sender(),
        finished_seance_ref: reference_session.seance_id,
        ghost_messages: vec![],
        initiator_messages: vec![],
        current_steps: 0,
        state: SessionState::Idle,
        initiated_on: ctx.timestamp,
    });
    log::info!(
        "[session] Ritual started seance_id={} ancestor_seance_id={} identity={}",
        new_session.seance_id,
        reference_session.seance_id,
        log_identity(&ctx.sender())
    );

    ctx.db.start_ghost_write().insert(StartGhostWriting {
        seance_id: new_session.seance_id,
        scheduled_at: ScheduleAt::Time(ctx.timestamp + Duration::from_secs(ctx.rng().gen_range(1..4))),
    });
    Ok(())
}

#[reducer]
pub fn submit_message(ctx: &ReducerContext, text: String, location: Iso3166Alpha2) -> Result<(), String> {
    if text.trim().is_empty() {
        return Err("Message cannot be empty".to_string());
    }
    log::debug!(
        "[submit] Incoming text_len={} identity={}",
        text.len(),
        log_identity(&ctx.sender())
    );
    let mut session = ctx.db.active_session().by_user().filter(&ctx.sender()).next().ok_or("Active session not found")?;
    let reference_session = ctx
        .db
        .finished_session()
        .seance_id()
        .find(session.finished_seance_ref)
        .ok_or("Reference session not found")?;
    let new_message = Message {
        message_id: 0,
        text: text.clone(),
        sender: ctx.sender(),
        sent: ctx.timestamp,
        location,
    };
    let new_message = ctx.db.message().insert(new_message);

    session.initiator_messages.push(new_message.message_id);
    let msg_preview: String = text.chars().take(60).collect::<String>();
    let msg_preview = if text.chars().count() > 60 {
        format!("{}…", msg_preview)
    } else {
        msg_preview
    };
    log::info!("[submit] seance_id={} user message \"{}\"", session.seance_id, msg_preview);

    // Check if session is complete
    if session.current_steps + 1 >= reference_session.total_steps {
        let new_finished_session = ctx.db.finished_session().insert(FinishedSession {
            seance_id: 0,
            initiator: session.initiator,
            ghost_messages: session.ghost_messages,
            initiator_messages: session.initiator_messages,
            total_steps: session.current_steps + 1,
            initiated_on: session.initiated_on,
            finished_on: ctx.timestamp,
        });
        ctx.db.active_session().seance_id().delete(&session.seance_id);
        log::info!(
            "[submit] seance_id={} completed → finished_session_id={}",
            session.seance_id,
            new_finished_session.seance_id
        );
        return Ok(())
    }

    session.state = SessionState::Idle;
    let session = ctx.db.active_session().seance_id().update(session);
    ctx.db.start_ghost_write().insert(StartGhostWriting {
        seance_id: session.seance_id,
        scheduled_at: ScheduleAt::Time(ctx.timestamp + Duration::from_secs(ctx.rng().gen_range(1..4))),
    });
    log::debug!(
        "[submit] seance_id={} state=Idle, next ghost write scheduled",
        session.seance_id
    );
    Ok(())
}

// Views
#[derive(SpacetimeType, PartialEq, Eq, Clone)]
pub struct CurrentSession {
    pub ghost_messages: Vec<Message>,
    pub initiator_messages: Vec<Message>,
    pub state: SessionState,
    pub initiated_on: Timestamp,
    pub is_complete: bool
}

#[view(accessor = user_active_session, public)]
pub fn user_active_session(ctx: &ViewContext) -> Option<CurrentSession> {
    if let Some(active_session) = ctx.db.active_session().by_user().filter(&ctx.sender()).next() {
        Some(CurrentSession {
            ghost_messages: active_session.ghost_messages.iter().map(|id| ctx.db.message().message_id().find(*id).unwrap()).collect(),
            initiator_messages: active_session.initiator_messages.iter().map(|id| ctx.db.message().message_id().find(*id).unwrap()).collect(),
            state: active_session.state,
            initiated_on: active_session.initiated_on,
            is_complete: false,
        })
    } else {
        let finished_session = ctx.db.finished_session().by_user().filter(&ctx.sender()).max_by_key(|s| s.finished_on);
        finished_session.map(|finished_session| CurrentSession {
            ghost_messages: finished_session.ghost_messages.iter().map(|id| ctx.db.message().message_id().find(*id).unwrap()).collect(),
            initiator_messages: finished_session.initiator_messages.iter().map(|id| ctx.db.message().message_id().find(*id).unwrap()).collect(),
            state: SessionState::Idle,
            initiated_on: finished_session.initiated_on,
            is_complete: true,
        })
    }
}
