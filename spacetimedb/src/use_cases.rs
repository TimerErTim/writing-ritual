use std::time::Duration;

use fxhash::FxHashMap;
use spacetimedb::{ReducerContext, ScheduleAt, Table, reducer};

use crate::{
    ROOT_BOOK_ID,
    countries::Iso3166Alpha2,
    model::{
        Book, BookWord, BookWordCandidate, BookWordVote, BookWordVotes, BookWordVotingEnds, book,
        book_word, book_word_candidate, book_word_vote, book_word_voting_ends,
    },
};

#[reducer]
pub fn handle_book_word_voting_ends(
    ctx: &ReducerContext,
    row: BookWordVotingEnds,
) -> Result<(), String> {
    if ctx.connection_id().is_some() {
        return Err("Can only be called by the server".to_string());
    }
    // Remove itself
    ctx.db.book_word_voting_ends().id().delete(row.id);
    log::info!("Book word voting ends for book {} at position {}", row.book_id, row.position);

    let book_word_candidates = ctx
        .db
        .book_word_candidate()
        .by_book_position()
        .filter((row.book_id, row.position));
    // Count votes for each candidate
    let vote_counts = book_word_candidates
        .map(|candidate| {
            let votes = ctx
                .db
                .book_word_vote()
                .candidate_id()
                .filter(&candidate.id)
                .count();
            (candidate.id, votes as u32)
        })
        .collect::<FxHashMap<u64, u32>>();
    // Find the candidate with the most votes
    let Some(highest_candidate_id) = vote_counts
        .iter()
        .max_by_key(|(_, count)| *count)
        .map(|(id, _)| *id)
    else {
        log::error!("No candidates found for book {} at position {}", row.book_id, row.position);
        return Err("No candidates found".to_string());
    };
    // Update the book word with the highest candidate
    ctx.db.book_word().insert(BookWord {
        id: highest_candidate_id,
        book_id: row.book_id,
        decided_at: ctx.timestamp,
        vote_distribution: vote_counts
            .iter()
            .map(|(id, count)| BookWordVotes {
                candidate_id: *id,
                vote_count: *count,
            })
            .collect(),
    });

    // Delete all other BookWordVotes for space efficiency
    let mut deleted_votes = 0;
    for (id, _) in vote_counts {
        if id == highest_candidate_id {
            continue;
        }
        deleted_votes += ctx.db.book_word_vote().candidate_id().delete(id);  
    }
    log::debug!("Deleted {} other BookWordVotes for book {} at position {}", deleted_votes, row.book_id, row.position);

    // Update the book position
    let book = ctx
        .db
        .book()
        .id()
        .find(row.book_id)
        .ok_or("Book not found")?;
    let new_book = ctx.db.book().id().update(Book {
        carret_position: book.carret_position + 1,
        ..book
    });
    log::info!("Updated book position to {}", new_book.carret_position);

    Ok(())
}

#[reducer]
pub fn vote_for_word(
    ctx: &ReducerContext,
    word: String,
    location: Iso3166Alpha2,
) -> Result<(), String> {
    // Word preprocessing and preflight checks
    let normalized_word = word
        .trim()
        .split_whitespace()
        .next()
        .ok_or("Word cannot be empty")?;

    log::info!("Voting for word: '{}'; by {}", normalized_word, ctx.sender());
    let book = ctx
        .db
        .book()
        .id()
        .find(ROOT_BOOK_ID)
        .ok_or("Book not found")?;
    let existing_voting_ends = ctx
        .db
        .book_word_voting_ends()
        .by_book_position()
        .filter((book.id, book.carret_position))
        .next();
    // Create new voting timeout if not exists
    let voting_ends = existing_voting_ends.unwrap_or_else(|| {
        let scheduled_at = ctx.timestamp + Duration::from_secs(15);
        log::info!("Creating new voting timeout at {} for book {} at position {}", scheduled_at, book.id, book.carret_position);
        ctx.db.book_word_voting_ends().insert(BookWordVotingEnds {
            id: 0,
            book_id: book.id,
            position: book.carret_position,
            scheduled_at: ScheduleAt::Time(scheduled_at),
        })
    });

    // Find candidate by normalized word and add new vote
    let mut book_word_candidates = ctx
        .db
        .book_word_candidate()
        .by_book_position()
        .filter((book.id, book.carret_position));
    if let Some(existing_candidate) =
        book_word_candidates.find(|candidate| candidate.word == normalized_word)
    {
        log::trace!("Voting for existing candidate by {}", ctx.sender());
        ctx.db.book_word_vote().insert(BookWordVote {
            id: 0,
            candidate_id: existing_candidate.id,
            voter: ctx.sender(),
            location,
        });
    } else {
        log::debug!("Creating new candidate for word: '{}'; by {}", normalized_word, ctx.sender());
        let new_candidate = ctx.db.book_word_candidate().insert(BookWordCandidate {
            id: 0,
            book_id: book.id,
            position: book.carret_position,
            word: normalized_word.to_string(),
        });
        ctx.db.book_word_vote().insert(BookWordVote {
            id: 0,
            candidate_id: new_candidate.id,
            voter: ctx.sender(),
            location,
        });
    }

    Ok(())
}
