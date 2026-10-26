//! Static card and noble data for the base game.
//!
//! Card list cross-checked against two independent community datasets
//! (bouk/splendimax and mcandocia/splendor_ai), which agree exactly.
//! Cost/requirement arrays are indexed by [`Color`] order: White, Blue, Green, Red, Black.

use crate::game::Color;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Card {
    pub tier: u8,
    pub points: u8,
    pub bonus: Color,
    pub cost: [u8; 5],
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct Noble {
    pub points: u8,
    pub req: [u8; 5],
}

pub const CARDS: [Card; 90] = [
    Card {
        tier: 1,
        points: 0,
        bonus: Color::White,
        cost: [0, 0, 0, 2, 1],
    },
    Card {
        tier: 1,
        points: 0,
        bonus: Color::White,
        cost: [0, 1, 1, 1, 1],
    },
    Card {
        tier: 1,
        points: 0,
        bonus: Color::White,
        cost: [0, 1, 2, 1, 1],
    },
    Card {
        tier: 1,
        points: 0,
        bonus: Color::White,
        cost: [0, 2, 0, 0, 2],
    },
    Card {
        tier: 1,
        points: 0,
        bonus: Color::White,
        cost: [0, 2, 2, 0, 1],
    },
    Card {
        tier: 1,
        points: 0,
        bonus: Color::White,
        cost: [0, 3, 0, 0, 0],
    },
    Card {
        tier: 1,
        points: 0,
        bonus: Color::White,
        cost: [3, 1, 0, 0, 1],
    },
    Card {
        tier: 1,
        points: 1,
        bonus: Color::White,
        cost: [0, 0, 4, 0, 0],
    },
    Card {
        tier: 1,
        points: 0,
        bonus: Color::Blue,
        cost: [0, 0, 0, 0, 3],
    },
    Card {
        tier: 1,
        points: 0,
        bonus: Color::Blue,
        cost: [0, 0, 2, 0, 2],
    },
    Card {
        tier: 1,
        points: 0,
        bonus: Color::Blue,
        cost: [0, 1, 3, 1, 0],
    },
    Card {
        tier: 1,
        points: 0,
        bonus: Color::Blue,
        cost: [1, 0, 0, 0, 2],
    },
    Card {
        tier: 1,
        points: 0,
        bonus: Color::Blue,
        cost: [1, 0, 1, 1, 1],
    },
    Card {
        tier: 1,
        points: 0,
        bonus: Color::Blue,
        cost: [1, 0, 1, 2, 1],
    },
    Card {
        tier: 1,
        points: 0,
        bonus: Color::Blue,
        cost: [1, 0, 2, 2, 0],
    },
    Card {
        tier: 1,
        points: 1,
        bonus: Color::Blue,
        cost: [0, 0, 0, 4, 0],
    },
    Card {
        tier: 1,
        points: 0,
        bonus: Color::Green,
        cost: [0, 0, 0, 3, 0],
    },
    Card {
        tier: 1,
        points: 0,
        bonus: Color::Green,
        cost: [0, 1, 0, 2, 2],
    },
    Card {
        tier: 1,
        points: 0,
        bonus: Color::Green,
        cost: [0, 2, 0, 2, 0],
    },
    Card {
        tier: 1,
        points: 0,
        bonus: Color::Green,
        cost: [1, 1, 0, 1, 1],
    },
    Card {
        tier: 1,
        points: 0,
        bonus: Color::Green,
        cost: [1, 1, 0, 1, 2],
    },
    Card {
        tier: 1,
        points: 0,
        bonus: Color::Green,
        cost: [1, 3, 1, 0, 0],
    },
    Card {
        tier: 1,
        points: 0,
        bonus: Color::Green,
        cost: [2, 1, 0, 0, 0],
    },
    Card {
        tier: 1,
        points: 1,
        bonus: Color::Green,
        cost: [0, 0, 0, 0, 4],
    },
    Card {
        tier: 1,
        points: 0,
        bonus: Color::Red,
        cost: [0, 2, 1, 0, 0],
    },
    Card {
        tier: 1,
        points: 0,
        bonus: Color::Red,
        cost: [1, 0, 0, 1, 3],
    },
    Card {
        tier: 1,
        points: 0,
        bonus: Color::Red,
        cost: [1, 1, 1, 0, 1],
    },
    Card {
        tier: 1,
        points: 0,
        bonus: Color::Red,
        cost: [2, 0, 0, 2, 0],
    },
    Card {
        tier: 1,
        points: 0,
        bonus: Color::Red,
        cost: [2, 0, 1, 0, 2],
    },
    Card {
        tier: 1,
        points: 0,
        bonus: Color::Red,
        cost: [2, 1, 1, 0, 1],
    },
    Card {
        tier: 1,
        points: 0,
        bonus: Color::Red,
        cost: [3, 0, 0, 0, 0],
    },
    Card {
        tier: 1,
        points: 1,
        bonus: Color::Red,
        cost: [4, 0, 0, 0, 0],
    },
    Card {
        tier: 1,
        points: 0,
        bonus: Color::Black,
        cost: [0, 0, 1, 3, 1],
    },
    Card {
        tier: 1,
        points: 0,
        bonus: Color::Black,
        cost: [0, 0, 2, 1, 0],
    },
    Card {
        tier: 1,
        points: 0,
        bonus: Color::Black,
        cost: [0, 0, 3, 0, 0],
    },
    Card {
        tier: 1,
        points: 0,
        bonus: Color::Black,
        cost: [1, 1, 1, 1, 0],
    },
    Card {
        tier: 1,
        points: 0,
        bonus: Color::Black,
        cost: [1, 2, 1, 1, 0],
    },
    Card {
        tier: 1,
        points: 0,
        bonus: Color::Black,
        cost: [2, 0, 2, 0, 0],
    },
    Card {
        tier: 1,
        points: 0,
        bonus: Color::Black,
        cost: [2, 2, 0, 1, 0],
    },
    Card {
        tier: 1,
        points: 1,
        bonus: Color::Black,
        cost: [0, 4, 0, 0, 0],
    },
    Card {
        tier: 2,
        points: 1,
        bonus: Color::White,
        cost: [0, 0, 3, 2, 2],
    },
    Card {
        tier: 2,
        points: 1,
        bonus: Color::White,
        cost: [2, 3, 0, 3, 0],
    },
    Card {
        tier: 2,
        points: 2,
        bonus: Color::White,
        cost: [0, 0, 0, 5, 0],
    },
    Card {
        tier: 2,
        points: 2,
        bonus: Color::White,
        cost: [0, 0, 0, 5, 3],
    },
    Card {
        tier: 2,
        points: 2,
        bonus: Color::White,
        cost: [0, 0, 1, 4, 2],
    },
    Card {
        tier: 2,
        points: 3,
        bonus: Color::White,
        cost: [6, 0, 0, 0, 0],
    },
    Card {
        tier: 2,
        points: 1,
        bonus: Color::Blue,
        cost: [0, 2, 2, 3, 0],
    },
    Card {
        tier: 2,
        points: 1,
        bonus: Color::Blue,
        cost: [0, 2, 3, 0, 3],
    },
    Card {
        tier: 2,
        points: 2,
        bonus: Color::Blue,
        cost: [0, 5, 0, 0, 0],
    },
    Card {
        tier: 2,
        points: 2,
        bonus: Color::Blue,
        cost: [2, 0, 0, 1, 4],
    },
    Card {
        tier: 2,
        points: 2,
        bonus: Color::Blue,
        cost: [5, 3, 0, 0, 0],
    },
    Card {
        tier: 2,
        points: 3,
        bonus: Color::Blue,
        cost: [0, 6, 0, 0, 0],
    },
    Card {
        tier: 2,
        points: 1,
        bonus: Color::Green,
        cost: [2, 3, 0, 0, 2],
    },
    Card {
        tier: 2,
        points: 1,
        bonus: Color::Green,
        cost: [3, 0, 2, 3, 0],
    },
    Card {
        tier: 2,
        points: 2,
        bonus: Color::Green,
        cost: [0, 0, 5, 0, 0],
    },
    Card {
        tier: 2,
        points: 2,
        bonus: Color::Green,
        cost: [0, 5, 3, 0, 0],
    },
    Card {
        tier: 2,
        points: 2,
        bonus: Color::Green,
        cost: [4, 2, 0, 0, 1],
    },
    Card {
        tier: 2,
        points: 3,
        bonus: Color::Green,
        cost: [0, 0, 6, 0, 0],
    },
    Card {
        tier: 2,
        points: 1,
        bonus: Color::Red,
        cost: [0, 3, 0, 2, 3],
    },
    Card {
        tier: 2,
        points: 1,
        bonus: Color::Red,
        cost: [2, 0, 0, 2, 3],
    },
    Card {
        tier: 2,
        points: 2,
        bonus: Color::Red,
        cost: [0, 0, 0, 0, 5],
    },
    Card {
        tier: 2,
        points: 2,
        bonus: Color::Red,
        cost: [1, 4, 2, 0, 0],
    },
    Card {
        tier: 2,
        points: 2,
        bonus: Color::Red,
        cost: [3, 0, 0, 0, 5],
    },
    Card {
        tier: 2,
        points: 3,
        bonus: Color::Red,
        cost: [0, 0, 0, 6, 0],
    },
    Card {
        tier: 2,
        points: 1,
        bonus: Color::Black,
        cost: [3, 0, 3, 0, 2],
    },
    Card {
        tier: 2,
        points: 1,
        bonus: Color::Black,
        cost: [3, 2, 2, 0, 0],
    },
    Card {
        tier: 2,
        points: 2,
        bonus: Color::Black,
        cost: [0, 0, 5, 3, 0],
    },
    Card {
        tier: 2,
        points: 2,
        bonus: Color::Black,
        cost: [0, 1, 4, 2, 0],
    },
    Card {
        tier: 2,
        points: 2,
        bonus: Color::Black,
        cost: [5, 0, 0, 0, 0],
    },
    Card {
        tier: 2,
        points: 3,
        bonus: Color::Black,
        cost: [0, 0, 0, 0, 6],
    },
    Card {
        tier: 3,
        points: 3,
        bonus: Color::White,
        cost: [0, 3, 3, 5, 3],
    },
    Card {
        tier: 3,
        points: 4,
        bonus: Color::White,
        cost: [0, 0, 0, 0, 7],
    },
    Card {
        tier: 3,
        points: 4,
        bonus: Color::White,
        cost: [3, 0, 0, 3, 6],
    },
    Card {
        tier: 3,
        points: 5,
        bonus: Color::White,
        cost: [3, 0, 0, 0, 7],
    },
    Card {
        tier: 3,
        points: 3,
        bonus: Color::Blue,
        cost: [3, 0, 3, 3, 5],
    },
    Card {
        tier: 3,
        points: 4,
        bonus: Color::Blue,
        cost: [6, 3, 0, 0, 3],
    },
    Card {
        tier: 3,
        points: 4,
        bonus: Color::Blue,
        cost: [7, 0, 0, 0, 0],
    },
    Card {
        tier: 3,
        points: 5,
        bonus: Color::Blue,
        cost: [7, 3, 0, 0, 0],
    },
    Card {
        tier: 3,
        points: 3,
        bonus: Color::Green,
        cost: [5, 3, 0, 3, 3],
    },
    Card {
        tier: 3,
        points: 4,
        bonus: Color::Green,
        cost: [0, 7, 0, 0, 0],
    },
    Card {
        tier: 3,
        points: 4,
        bonus: Color::Green,
        cost: [3, 6, 3, 0, 0],
    },
    Card {
        tier: 3,
        points: 5,
        bonus: Color::Green,
        cost: [0, 7, 3, 0, 0],
    },
    Card {
        tier: 3,
        points: 3,
        bonus: Color::Red,
        cost: [3, 5, 3, 0, 3],
    },
    Card {
        tier: 3,
        points: 4,
        bonus: Color::Red,
        cost: [0, 0, 7, 0, 0],
    },
    Card {
        tier: 3,
        points: 4,
        bonus: Color::Red,
        cost: [0, 3, 6, 3, 0],
    },
    Card {
        tier: 3,
        points: 5,
        bonus: Color::Red,
        cost: [0, 0, 7, 3, 0],
    },
    Card {
        tier: 3,
        points: 3,
        bonus: Color::Black,
        cost: [3, 3, 5, 3, 0],
    },
    Card {
        tier: 3,
        points: 4,
        bonus: Color::Black,
        cost: [0, 0, 0, 7, 0],
    },
    Card {
        tier: 3,
        points: 4,
        bonus: Color::Black,
        cost: [0, 0, 3, 6, 3],
    },
    Card {
        tier: 3,
        points: 5,
        bonus: Color::Black,
        cost: [0, 0, 0, 7, 3],
    },
];

/// The ten noble tiles: each adjacent color pair (4+4) and each consecutive
/// color triple (3+3+3) in the White-Blue-Green-Red-Black cycle.
pub const NOBLES: [Noble; 10] = [
    Noble {
        points: 3,
        req: [4, 4, 0, 0, 0],
    },
    Noble {
        points: 3,
        req: [0, 4, 4, 0, 0],
    },
    Noble {
        points: 3,
        req: [0, 0, 4, 4, 0],
    },
    Noble {
        points: 3,
        req: [0, 0, 0, 4, 4],
    },
    Noble {
        points: 3,
        req: [4, 0, 0, 0, 4],
    },
    Noble {
        points: 3,
        req: [3, 3, 3, 0, 0],
    },
    Noble {
        points: 3,
        req: [0, 3, 3, 3, 0],
    },
    Noble {
        points: 3,
        req: [0, 0, 3, 3, 3],
    },
    Noble {
        points: 3,
        req: [3, 0, 0, 3, 3],
    },
    Noble {
        points: 3,
        req: [3, 3, 0, 0, 3],
    },
];
