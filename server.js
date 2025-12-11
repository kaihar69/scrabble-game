const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);

app.use(express.static('public'));

// --- KONFIGURATION ---
// 24 Stunden Inaktivität erlaubt, bevor gelöscht wird
const MAX_IDLE_TIME = 24 * 60 * 60 * 1000; 
const CLEANUP_INTERVAL = 30 * 60 * 1000;

const LETTER_SCORES = {
    "A": 1, "B": 3, "C": 4, "D": 1, "E": 1, "F": 4, "G": 2, "H": 2, 
    "I": 1, "J": 6, "K": 4, "L": 2, "M": 3, "N": 1, "O": 2, "P": 4, 
    "Q": 10, "R": 1, "S": 1, "T": 1, "U": 1, "V": 6, "W": 3, "X": 8, 
    "Y": 10, "Z": 3
};

const INITIAL_BAG_TEMPLATE = [];
const distribution = [
    { l: 'E', c: 15 }, { l: 'N', c: 9 }, { l: 'S', c: 7 }, { l: 'I', c: 6 }, 
    { l: 'R', c: 6 }, { l: 'T', c: 6 }, { l: 'U', c: 6 }, { l: 'A', c: 5 },
    { l: 'D', c: 4 }, { l: 'H', c: 4 }, { l: 'G', c: 3 }, { l: 'L', c: 3 },
    { l: 'O', c: 3 }, { l: 'M', c: 4 }, { l: 'B', c: 2 }, { l: 'W', c: 1 },
    { l: 'Z', c: 1 }, { l: 'K', c: 2 }, { l: 'V', c: 1 }, { l: 'P', c: 1 },
    { l: 'J', c: 1 }, { l: 'X', c: 1 }, { l: 'Q', c: 1 }, { l: 'Y', c: 1 }
];
distribution.forEach(item => { for(let i=0; i<item.c; i++) INITIAL_BAG_TEMPLATE.push(item.l); });

// --- HILFSFUNKTIONEN ---

function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

function drawTiles(bag, count) {
    const drawn = [];
    for(let i=0; i<count; i++) {
        if(bag.length > 0) drawn.push(bag.pop());
    }
    return drawn;
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

function validateMove(moves, board, isFirstMove) {
    if (moves.length === 0) return { valid: false };
    const indices = moves.map(m => m.index).sort((a, b) => a - b);
    const coords = indices.map(i => ({ x: i % 15, y: Math.floor(i / 15) }));
    const allSameX = coords.every(c => c.x === coords[0].x);
    const allSameY = coords.every(c => c.y === coords[0].y);
    if (!allSameX && !allSameY) return { valid: false, msg: "Steine müssen in einer Linie liegen." };

    if (isFirstMove) {
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
        if (!isConnected) return { valid: false, msg: "Muss an bestehende Steine andocken." };
    }
    return { valid: true };
}

// --- STATE MANAGEMENT (RAM) ---
// Hier leben die Spiele jetzt wieder
const games = {};

function createGame(roomId) {
    return {
        id: roomId,
        board: Array(15 * 15).fill(null),
        tileBag: shuffle([...INITIAL_BAG_TEMPLATE]),
        isFirstMove: true,
        activePlayerIndex: 0,
        players: [], // { id, name, hand, score, isBot }
        lastActivity: Date.now()
    };
}

// --- BOT LOGIK ---
function triggerBotTurn(room) {
    if (!games[room]) return;
    const game = games[room];
    const player = game.players[game.activePlayerIndex];

    if (!player || !player.isBot) return;

    setTimeout(() => {
        if (!games[room]) return;

        if (game.isFirstMove) {
            // CHEF legen
            const cheatWord = ['C', 'H', 'E', 'F'];
            const cheatIndices = [112, 113, 114, 115];
            const moves = [];
            cheatWord.forEach((char, i) => moves.push({ index: cheatIndices[i], letter: char }));
            
            const points = calculateMoveScore(moves, game.board);
            player.score += points;
            
            moves.forEach(move => {
                game.board[move.index] = move.letter;
                // Hand fake cleanup
                if(player.hand.length > 0) player.hand.pop();
            });
            
            const newTiles = drawTiles(game.tileBag, moves.length);
            player.hand.push(...newTiles);
            game.isFirstMove = false;
            
            io.to(room).emit('game-msg', `${player.name} legt CHEF (${points} Pkt).`);

        } else {
            // Tauschen oder Passen
            const count = Math.min(player.hand.length, 3);
            if (count > 0 && game.tileBag.length >= count) {
                const swapped = player.hand.splice(0, count);
                game.tileBag.push(...swapped);
                shuffle(game.tileBag);
                const newTiles = drawTiles(game.tileBag, count);
                player.hand.push(...newTiles);
                
                io.to(room).emit('game-msg', `${player.name} tauscht ${count} Steine.`);
            } else {
                io.to(room).emit('game-msg', `${player.name} passt.`);
            }
        }

        game.activePlayerIndex = (game.activePlayerIndex + 1) % game.players.length;
        game.lastActivity = Date.now();
        
        io.to(room).emit('update-game-state', {
            board: game.board,
            players: game.players.map(p => ({ name: p.name, score: p.score, id: p.id, isBot: p.isBot })),
            activePlayerIndex: game.activePlayerIndex,
            bagCount: game.tileBag.length
        });

        triggerBotTurn(room); 

    }, 2000);
}

// --- HAUSMEISTER (Cleanup) ---
setInterval(() => {
    const now = Date.now();
    Object.keys(games).forEach(roomId => {
        if (now - games[roomId].lastActivity > MAX_IDLE_TIME) {
            delete games[roomId];
        }
    });
}, CLEANUP_INTERVAL);


// --- SOCKET LOGIK ---
io.on('connection', (socket) => {
    
    // 1. BEITRETEN
    socket.on('join-game', ({ name, roomId }) => {
        const room = roomId.trim().toUpperCase() || "LOBBY";
        socket.join(room); 

        if (!games[room]) games[room] = createGame(room);
        const game = games[room];
        game.lastActivity = Date.now();

        if (game.players.length >= 4) {
            socket.emit('error-msg', "Raum ist voll.");
            return;
        }

        const newPlayer = {
            id: socket.id,
            name: name || `Spieler ${game.players.length + 1}`,
            hand: drawTiles(game.tileBag, 7),
            score: 0,
            isBot: false
        };
        game.players.push(newPlayer);
        socket.data.roomId = room;

        io.to(room).emit('update-game-state', {
            board: game.board,
            players: game.players.map(p => ({ name: p.name, score: p.score, id: p.id, isBot: p.isBot })),
            activePlayerIndex: game.activePlayerIndex,
            bagCount: game.tileBag.length
        });
        socket.emit('update-hand', newPlayer.hand);
        
        triggerBotTurn(room);
    });

    // BOT ADD
    socket.on('add-bot', () => {
        const room = socket.data.roomId;
        if (!room || !games[room]) return;
        const game = games[room];

        if (game.players.length >= 4) return;

        const botName = "Robo-Chef " + (Math.floor(Math.random()*100));
        game.players.push({
            id: "BOT-" + Date.now(),
            name: botName,
            hand: drawTiles(game.tileBag, 7),
            score: 0,
            isBot: true
        });
        
        io.to(room).emit('update-game-state', {
            board: game.board,
            players: game.players.map(p => ({ name: p.name, score: p.score, id: p.id, isBot: p.isBot })),
            activePlayerIndex: game.activePlayerIndex,
            bagCount: game.tileBag.length
        });
        io.to(room).emit('game-msg', `${botName} ist beigetreten.`);
        
        triggerBotTurn(room);
    });

    // 2. LEGEN
    socket.on('action-place', (moves) => {
        const room = socket.data.roomId;
        if (!room || !games[room]) return;
        const game = games[room];
        game.lastActivity = Date.now();

        const pIndex = game.players.findIndex(p => p.id === socket.id);
        if (pIndex !== game.activePlayerIndex) return;

        const player = game.players[pIndex];
        let tempHand = [...player.hand];
        let hasTiles = true;
        for (let move of moves) {
            const idx = tempHand.indexOf(move.letter);
            if (idx === -1) hasTiles = false; else tempHand.splice(idx, 1);
        }
        if (!hasTiles) return;

        const validation = validateMove(moves, game.board, game.isFirstMove);
        if (!validation.valid) { socket.emit('error-msg', validation.msg); return; }

        const points = calculateMoveScore(moves, game.board);
        player.score += points;

        moves.forEach(move => {
            game.board[move.index] = move.letter;
            const handIndex = player.hand.indexOf(move.letter);
            if (handIndex !== -1) player.hand.splice(handIndex, 1);
        });

        const newTiles = drawTiles(game.tileBag, moves.length);
        player.hand.push(...newTiles);
        
        game.isFirstMove = false;
        game.activePlayerIndex = (game.activePlayerIndex + 1) % game.players.length;

        io.to(room).emit('update-game-state', {
            board: game.board,
            players: game.players.map(p => ({ name: p.name, score: p.score, id: p.id, isBot: p.isBot })),
            activePlayerIndex: game.activePlayerIndex,
            bagCount: game.tileBag.length
        });
        socket.emit('update-hand', player.hand);
        io.to(room).emit('game-msg', `${player.name} hat ${points} Punkte.`);

        triggerBotTurn(room);
    });

    // 3. TAUSCHEN
    socket.on('action-swap', (letters) => {
        const room = socket.data.roomId;
        if (!room || !games[room]) return;
        const game = games[room];
        game.lastActivity = Date.now();

        const pIndex = game.players.findIndex(p => p.id === socket.id);
        if (pIndex !== game.activePlayerIndex) return;
        const player = game.players[pIndex];

        if (game.tileBag.length < letters.length) { socket.emit('error-msg', "Zu wenige Steine!"); return; }

        let valid = true;
        let tempHand = [...player.hand];
        letters.forEach(l => {
            const idx = tempHand.indexOf(l);
            if (idx === -1) valid = false; else tempHand.splice(idx, 1);
        });
        if(!valid) return;

        letters.forEach(l => game.tileBag.push(l));
        shuffle(game.tileBag);
        
        letters.forEach(l => {
            const realIdx = player.hand.indexOf(l);
            player.hand.splice(realIdx, 1);
        });
        
        const newTiles = drawTiles(game.tileBag, letters.length);
        player.hand.push(...newTiles);

        game.activePlayerIndex = (game.activePlayerIndex + 1) % game.players.length;

        io.to(room).emit('update-game-state', {
            board: game.board,
            players: game.players.map(p => ({ name: p.name, score: p.score, id: p.id, isBot: p.isBot })),
            activePlayerIndex: game.activePlayerIndex,
            bagCount: game.tileBag.length
        });
        socket.emit('update-hand', player.hand);
        io.to(room).emit('game-msg', `${player.name} tauscht.`);

        triggerBotTurn(room);
    });

    // 4. PASSEN
    socket.on('action-pass', () => {
        const room = socket.data.roomId;
        if (!room || !games[room]) return;
        const game = games[room];
        game.lastActivity = Date.now();

        const pIndex = game.players.findIndex(p => p.id === socket.id);
        if (pIndex !== game.activePlayerIndex) return;

        game.activePlayerIndex = (game.activePlayerIndex + 1) % game.players.length;

        io.to(room).emit('update-game-state', {
            board: game.board,
            players: game.players.map(p => ({ name: p.name, score: p.score, id: p.id, isBot: p.isBot })),
            activePlayerIndex: game.activePlayerIndex,
            bagCount: game.tileBag.length
        });
        io.to(room).emit('game-msg', `${game.players[pIndex].name} passt.`);

        triggerBotTurn(room);
    });

    socket.on('disconnect', () => {
        // Spieler bleibt "drin" bis zum Server-Neustart oder Hausmeister
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server läuft auf Port ${PORT}`);
});
