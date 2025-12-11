const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);

app.use(express.static('public'));

// --- Setup ---
const LETTER_SCORES = {
    "A": 1, "B": 3, "C": 4, "D": 1, "E": 1, "F": 4, "G": 2, "H": 2, 
    "I": 1, "J": 6, "K": 4, "L": 2, "M": 3, "N": 1, "O": 2, "P": 4, 
    "Q": 10, "R": 1, "S": 1, "T": 1, "U": 1, "V": 6, "W": 3, "X": 8, 
    "Y": 10, "Z": 3
};

const INITIAL_BAG = [];
const distribution = [
    { l: 'E', c: 15 }, { l: 'N', c: 9 }, { l: 'S', c: 7 }, { l: 'I', c: 6 }, 
    { l: 'R', c: 6 }, { l: 'T', c: 6 }, { l: 'U', c: 6 }, { l: 'A', c: 5 },
    { l: 'D', c: 4 }, { l: 'H', c: 4 }, { l: 'G', c: 3 }, { l: 'L', c: 3 },
    { l: 'O', c: 3 }, { l: 'M', c: 4 }, { l: 'B', c: 2 }, { l: 'W', c: 1 },
    { l: 'Z', c: 1 }, { l: 'K', c: 2 }, { l: 'V', c: 1 }, { l: 'P', c: 1 },
    { l: 'J', c: 1 }, { l: 'X', c: 1 }, { l: 'Q', c: 1 }, { l: 'Y', c: 1 }
];
distribution.forEach(item => { for(let i=0; i<item.c; i++) INITIAL_BAG.push(item.l); });

function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

function getMultipliers(index) {
    const x = index % 15; const y = Math.floor(index / 15); const k = x + "," + y;
    if (k === "7,7") return { wm: 2, lm: 1 };
    if ((x===0||x===7||x===14) && (y===0||y===7||y===14)) return { wm: 3, lm: 1 };
    if ((x===y || x+y===14)) { if(x>=1 && x<=4) return { wm: 2, lm: 1 }; if(x>=10 && x<=13) return { wm: 2, lm: 1 }; }
    if ((x===5||x===9)&&(y===1||y===5||y===9||y===13)) return { wm: 1, lm: 3 };
    if ((y===5||y===9)&&(x===1||x===5||x===9||x===13)) return { wm: 1, lm: 3 };
    if ((x===3||x===11)&&(y===0||y===7||y===14)) return { wm: 1, lm: 2 };
    if ((y===3||y===11)&&(x===0||x===7||x===14)) return { wm: 1, lm: 2 };
    if ((x===2||x===6||x===8||x===12) && (y===6||y===8)) return { wm: 1, lm: 2 };
    if ((y===2||y===6||y===8||y===12) && (x===6||x===8)) return { wm: 1, lm: 2 };
    return { wm: 1, lm: 1 };
}

// --- Status ---
let gameState = {
    board: Array(15 * 15).fill(null),
    tileBag: shuffle([...INITIAL_BAG]),
    isFirstMove: true,
    activePlayerIndex: 0, 
    // Players Array speichert jetzt Objekte mit Namen
    players: [null, null] 
};

function drawTiles(count) {
    const drawn = [];
    for(let i=0; i<count; i++) {
        if(gameState.tileBag.length > 0) drawn.push(gameState.tileBag.pop());
    }
    return drawn;
}

function calculateMoveScore(moves, board) {
    let totalScore = 0;
    const newIndices = moves.map(m => m.index);
    let tempBoard = [...board];
    moves.forEach(m => tempBoard[m.index] = m.letter);
    const isHorizontal = moves.length > 1 ? (Math.floor(moves[0].index/15) === Math.floor(moves[1].index/15)) : true;

    function scoreWordAt(startIndex, scanHorizontal) {
        let currentIdx = startIndex;
        const step = scanHorizontal ? 1 : 15;
        while(true) {
            const prev = currentIdx - step;
            if (scanHorizontal && Math.floor(prev/15) !== Math.floor(currentIdx/15)) break;
            if (!scanHorizontal && prev < 0) break;
            if (tempBoard[prev]) currentIdx = prev; else break;
        }
        let wordScore = 0; let wordMultiplier = 1; let lettersCount = 0;
        while(true) {
            if (currentIdx >= 225) break;
            if (scanHorizontal && Math.floor(currentIdx/15) !== Math.floor(startIndex/15) && currentIdx !== startIndex) break;
            const letter = tempBoard[currentIdx];
            if (!letter) break;
            let val = LETTER_SCORES[letter] || 0;
            if (newIndices.includes(currentIdx)) {
                const m = getMultipliers(currentIdx);
                val *= m.lm; wordMultiplier *= m.wm;
            }
            wordScore += val; lettersCount++; currentIdx += step;
        }
        return lettersCount > 1 ? wordScore * wordMultiplier : 0;
    }

    let mainScore = scoreWordAt(moves[0].index, isHorizontal);
    if (moves.length === 1) mainScore += scoreWordAt(moves[0].index, !isHorizontal);
    totalScore += mainScore;
    if (moves.length > 1) { moves.forEach(m => { totalScore += scoreWordAt(m.index, !isHorizontal); }); }
    if (moves.length === 7) totalScore += 50;
    return totalScore;
}

function validateMove(moves, board) {
    if (moves.length === 0) return { valid: false };
    const indices = moves.map(m => m.index).sort((a, b) => a - b);
    const coords = indices.map(i => ({ x: i % 15, y: Math.floor(i / 15) }));
    const allSameX = coords.every(c => c.x === coords[0].x);
    const allSameY = coords.every(c => c.y === coords[0].y);
    if (!allSameX && !allSameY) return { valid: false, msg: "Steine müssen in einer Linie liegen." };

    if (gameState.isFirstMove) {
        if (!indices.includes(112)) return { valid: false, msg: "Start muss in der Mitte sein." };
    } else {
        let isConnected = false;
        const directions = [-1, 1, -15, 15];
        indices.forEach(idx => {
            directions.forEach(dir => {
                const n = idx + dir;
                if (n >= 0 && n < 225 && board[n] !== null) isConnected = true;
            });
        });
        if (!isConnected) return { valid: false, msg: "Kein Anschluss." };
    }
    return { valid: true };
}

io.on('connection', (socket) => {
    console.log('Neue Verbindung (noch ohne Name):', socket.id);
    
    // Wir senden das aktuelle Board auch an Leute, die sich noch nicht eingeloggt haben (für den Hintergrund)
    socket.emit('update-board', gameState.board);

    // Erst wenn der Spieler seinen Namen sendet, darf er mitspielen
    socket.on('join-game', (playerName) => {
        // Freien Platz suchen
        let myIndex = -1;
        if (gameState.players[0] === null) myIndex = 0;
        else if (gameState.players[1] === null) myIndex = 1;

        if (myIndex === -1) {
            socket.emit('game-full', true);
            // Namen trotzdem senden, damit er sieht wer spielt
            const names = gameState.players.map(p => p ? p.name : "Warte auf Spieler...");
            socket.emit('update-names', names);
            return;
        }

        // Spieler registrieren
        gameState.players[myIndex] = {
            id: socket.id,
            name: playerName || `Spieler ${myIndex + 1}`, // Fallback Name
            hand: drawTiles(7),
            score: 0
        };

        // Daten senden
        socket.emit('player-assignment', { playerIndex: myIndex });
        socket.emit('update-hand', gameState.players[myIndex].hand);
        
        // Allen sagen, wer spielt und wie es steht
        const currentScores = gameState.players.map(p => p ? { score: p.score } : { score: 0 });
        const currentNames = gameState.players.map(p => p ? p.name : "Warte auf Spieler...");
        
        io.emit('update-scores', currentScores);
        io.emit('update-names', currentNames); // NEU: Namen verteilen
        io.emit('update-turn', gameState.activePlayerIndex);
    });

    socket.on('submit-turn', (moves) => {
        // Welcher Index gehört zu diesem Socket?
        let myIndex = -1;
        if (gameState.players[0] && gameState.players[0].id === socket.id) myIndex = 0;
        else if (gameState.players[1] && gameState.players[1].id === socket.id) myIndex = 1;

        if (myIndex === -1) return; // Nicht eingeloggt
        if (gameState.activePlayerIndex !== myIndex) return; // Nicht dran

        const player = gameState.players[myIndex];

        // Cheat Check
        let tempHand = [...player.hand];
        let hasTiles = true;
        for (let move of moves) {
            const idx = tempHand.indexOf(move.letter);
            if (idx === -1) hasTiles = false; else tempHand.splice(idx, 1);
        }
        if (!hasTiles) { socket.emit('move-error', "Buchstaben fehlen!"); return; }

        const validation = validateMove(moves, gameState.board);
        if (!validation.valid) { socket.emit('move-error', validation.msg); return; }

        // Ausführen
        const points = calculateMoveScore(moves, gameState.board);
        player.score += points;

        moves.forEach(move => {
            gameState.board[move.index] = move.letter;
            const handIndex = player.hand.indexOf(move.letter);
            if (handIndex !== -1) player.hand.splice(handIndex, 1);
        });

        const newTiles = drawTiles(moves.length);
        player.hand.push(...newTiles);
        gameState.isFirstMove = false;

        // Zug wechseln
        gameState.activePlayerIndex = (gameState.activePlayerIndex === 0) ? 1 : 0;

        // Updates
        io.emit('update-board', gameState.board);
        socket.emit('update-hand', player.hand);
        
        const currentScores = gameState.players.map(p => p ? { score: p.score } : { score: 0 });
        io.emit('update-scores', currentScores);
        io.emit('update-turn', gameState.activePlayerIndex);
    });

    socket.on('disconnect', () => {
        // Finden wer gegangen ist
        let leaverIndex = -1;
        if (gameState.players[0] && gameState.players[0].id === socket.id) leaverIndex = 0;
        else if (gameState.players[1] && gameState.players[1].id === socket.id) leaverIndex = 1;

        if (leaverIndex !== -1) {
            console.log(`${gameState.players[leaverIndex].name} hat verlassen.`);
            gameState.players[leaverIndex] = null;
            // Namen updaten
            const currentNames = gameState.players.map(p => p ? p.name : "Warte auf Spieler...");
            io.emit('update-names', currentNames);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => { console.log(`Server läuft auf Port ${PORT}`); });
