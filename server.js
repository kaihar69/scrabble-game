const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);

// Frontend-Dateien bereitstellen
app.use(express.static('public'));

// --- Setup: Buchstaben-Beutel (Deutsch) ---
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

// Hilfsfunktionen
function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

// Spielstatus
let gameState = {
    board: Array(15 * 15).fill(null),
    players: {},
    tileBag: shuffle([...INITIAL_BAG]),
    isFirstMove: true 
};

function drawTiles(count) {
    const drawn = [];
    for(let i=0; i<count; i++) {
        if(gameState.tileBag.length > 0) drawn.push(gameState.tileBag.pop());
    }
    return drawn;
}

// --- Regel-Prüfung ---
function validateMove(moves, board) {
    if (moves.length === 0) return { valid: false, msg: "Keine Steine gelegt." };

    const indices = moves.map(m => m.index).sort((a, b) => a - b);
    const coords = indices.map(i => ({ x: i % 15, y: Math.floor(i / 15) }));
    
    // 1. Linie prüfen
    const allSameX = coords.every(c => c.x === coords[0].x);
    const allSameY = coords.every(c => c.y === coords[0].y);

    if (!allSameX && !allSameY) {
        return { valid: false, msg: "Steine müssen in einer Linie liegen." };
    }

    // 2. Start-Regel
    if (gameState.isFirstMove) {
        const touchesCenter = indices.includes(112);
        if (!touchesCenter) return { valid: false, msg: "Erster Zug muss über die Mitte (Stern) gehen." };
    } else {
        // 3. Anschluss-Regel
        let isConnected = false;
        const directions = [-1, 1, -15, 15];
        
        indices.forEach(idx => {
            directions.forEach(dir => {
                const neighbor = idx + dir;
                if (neighbor >= 0 && neighbor < 225 && board[neighbor] !== null) {
                    isConnected = true;
                }
            });
        });

        if (!isConnected) return { valid: false, msg: "Wort muss an bestehende Steine andocken." };
    }

    return { valid: true };
}

// --- Socket Verbindung ---
io.on('connection', (socket) => {
    console.log('Neuer Spieler:', socket.id);
    
    // Initial: Hand geben
    gameState.players[socket.id] = { hand: drawTiles(7), score: 0 };
    
    const playerIndex = Object.keys(gameState.players).length - 1;
    socket.emit('player-assignment', { playerIndex });
    socket.emit('update-board', gameState.board);
    socket.emit('update-hand', gameState.players[socket.id].hand);

    // Spieler sendet Zug
    socket.on('submit-turn', (moves) => {
        const player = gameState.players[socket.id];
        
        // Cheat-Schutz: Hat er die Steine?
        let tempHand = [...player.hand];
        let hasTiles = true;
        for (let move of moves) {
            const idx = tempHand.indexOf(move.letter);
            if (idx === -1) hasTiles = false;
            else tempHand.splice(idx, 1);
        }
        
        if (!hasTiles) {
            socket.emit('move-error', "Fehler: Du hast diese Buchstaben nicht!");
            return;
        }

        // Regel-Check
        const validation = validateMove(moves, gameState.board);
        if (!validation.valid) {
            socket.emit('move-error', validation.msg);
            return;
        }

        // Zug ausführen
        moves.forEach(move => {
            gameState.board[move.index] = move.letter;
            const handIndex = player.hand.indexOf(move.letter);
            if (handIndex !== -1) player.hand.splice(handIndex, 1);
        });

        // Nachziehen
        const newTiles = drawTiles(moves.length);
        player.hand.push(...newTiles);

        gameState.isFirstMove = false;

        io.emit('update-board', gameState.board);
        socket.emit('update-hand', player.hand);
    });

    socket.on('disconnect', () => {
        delete gameState.players[socket.id];
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server läuft auf Port ${PORT}`);
});
