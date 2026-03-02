use spacetimedb::{
    AnonymousViewContext, Identity, ScheduleAt, SpacetimeType, Timestamp, ViewContext, table, view
};

use crate::{ROOT_BOOK_ID, countries::Iso3166Alpha2, use_cases::handle_book_word_voting_ends};

// Tables
#[table(accessor = book, private)]
pub struct Book {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub title: String,
    pub author: String,
    pub carret_position: u32,
    pub started_at: Timestamp,
}

#[table(accessor = book_word, private)]
pub struct BookWord {
    #[primary_key]
    #[auto_inc]
    pub id: u64, // Shares same Id with chosen candidate
    #[index(btree)]
    pub book_id: u64,
    pub decided_at: Timestamp,
    pub vote_distribution: Vec<BookWordVotes>,
}

#[derive(SpacetimeType)]
pub struct BookWordVotes {
    pub candidate_id: u64,
    pub vote_count: u32,
}

#[table(accessor = book_word_candidate, private, 
    index(accessor = by_book_position, btree(columns = [book_id, position])),
    index(accessor = by_id_book_position, btree(columns = [id, book_id, position]))
)]
pub struct BookWordCandidate {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub book_id: u64,
    pub word: String,
    pub position: u32,
}

#[table(accessor = book_word_vote, private)]
pub struct BookWordVote {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    #[index(btree)]
    pub candidate_id: u64,
    #[index(btree)]
    pub voter: Identity,
    pub location: Iso3166Alpha2,
}

#[table(accessor = book_word_voting_ends, private,
    scheduled(handle_book_word_voting_ends),
    index(accessor = by_book_position, btree(columns = [book_id, position]))
)]
pub struct BookWordVotingEnds {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub book_id: u64,
    pub position: u32,
    pub scheduled_at: ScheduleAt,
}

// Views
#[derive(SpacetimeType)]

pub struct CurrentCandidateView {
    pub word: String,
    pub votes_amount: u32,
}

#[derive(SpacetimeType)]
pub struct CurrentVotingView {
    pub voting_ends: Timestamp,
    pub candidates: Vec<CurrentCandidateView>,
}

#[view(accessor = current_word_votes, public)]
pub fn current_word_votes(ctx: &AnonymousViewContext) -> Option<CurrentVotingView> {
    // Collect all candidates at the current position
    let book = ctx.db.book().id().find(ROOT_BOOK_ID)?;
    let Some(voting_ends) = ctx
        .db
        .book_word_voting_ends()
        .by_book_position()
        .filter((book.id, book.carret_position))
        .next()
    else {
        return None;
    };

    let existing_candidates = ctx
        .db
        .book_word_candidate()
        .by_book_position()
        .filter((book.id, book.carret_position));

    let candidates = existing_candidates
        .map(|candidate| {
            let votes = ctx
                .db
                .book_word_vote()
                .candidate_id()
                .filter(&candidate.id)
                .count();
            CurrentCandidateView {
                word: candidate.word,
                votes_amount: votes as u32,
            }
        })
        .collect();

    Some(CurrentVotingView {
        voting_ends: match voting_ends.scheduled_at {
            ScheduleAt::Time(time) => time,
            ScheduleAt::Interval(_) => {
                unreachable!("Voting ends should be a timestamp, not duration")
            }
        },
        candidates,
    })
}

#[derive(SpacetimeType)]
pub struct CurrentBookView {
    pub carret_position: u32,
    pub words: Vec<BookWordView>,
}

#[derive(SpacetimeType)]
pub struct BookWordView {
    pub word: String,
    pub decided_at: Timestamp,
    pub votes_distribution: Vec<BookWordVotesView>,
}

#[derive(SpacetimeType)]
pub struct BookWordVotesView {
    pub word: String,
    pub vote_count: u32,
}

#[view(accessor = current_book_view, public)]
pub fn current_book_view(ctx: &AnonymousViewContext) -> Option<CurrentBookView> {
    let book = ctx.db.book().id().find(ROOT_BOOK_ID).unwrap();

    let mut words: Vec<_> = ctx.db.book_word().book_id().filter(book.id).map(|word| BookWordView {
        word: ctx.db.book_word_candidate().id().find(word.id).unwrap().word,
        decided_at: word.decided_at,
        votes_distribution: word.vote_distribution.iter().map(|vote| BookWordVotesView {
            word: ctx.db.book_word_candidate().id().find(vote.candidate_id).unwrap().word,
            vote_count: vote.vote_count,
        }).collect(),
    }).collect();
    words.sort_by_key(|word| word.decided_at);
    
    Some(CurrentBookView { carret_position: book.carret_position, words })
}

#[derive(SpacetimeType)]
pub struct MyVote {
    pub word: String,
    pub location: Iso3166Alpha2,
}

#[view(accessor = my_vote, public)]
pub fn my_vote(ctx: &ViewContext) -> Option<MyVote> {
    let book = ctx.db.book().id().find(ROOT_BOOK_ID)?;
    let Some(voting_ends) = ctx
        .db
        .book_word_voting_ends()
        .by_book_position()
        .filter((book.id, book.carret_position))
        .next()
    else {
        return None;
    };

    ctx.db.book_word_vote().voter().filter(ctx.sender()).find_map(|vote|{
        ctx.db.book_word_candidate().by_id_book_position().filter((vote.candidate_id, book.id, book.carret_position)).next().map(|candidate| (vote, candidate))
    }).map(|(vote, candidate)| MyVote {
        word: candidate.word,
        location: vote.location,
    })
}
