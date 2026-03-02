use std::time::Duration;

use rand::Rng;
use spacetimedb::{
    Identity, ReducerContext, ScheduleAt, SpacetimeType, Table, Timestamp, ViewContext, reducer,
    table, view,
};

use crate::{
    countries::Iso3166Alpha2,
    model::{Book, book},
};

mod countries;
mod model;
mod use_cases;

const ROOT_BOOK_ID: u64 = 1;

// ---------------------------------------------------------------------------
// Reducers
// ---------------------------------------------------------------------------

#[reducer(init)]
pub fn init(ctx: &ReducerContext) {
    // Create initial book
    log::info!("Creating initial book");
    ctx.db.book().insert(Book {
        id: ROOT_BOOK_ID,
        title: "The Great Book".to_string(),
        author: "Everyone".to_string(),
        carret_position: 0,
        started_at: ctx.timestamp,
    });
}

#[reducer(client_connected)]
pub fn identity_connected(ctx: &ReducerContext) -> Result<(), String> {
    log::info!("Client connected '{}'", ctx.sender());
    Ok(())
}

#[reducer(client_disconnected)]
pub fn identity_disconnected(ctx: &ReducerContext) -> Result<(), String> {
    log::info!("Client disconnected '{}'", ctx.sender());
    Ok(())
}
