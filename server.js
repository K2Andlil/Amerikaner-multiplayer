const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Add this route to serve the lobby page at root
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'lobby.html'));
});

// Game state management
const games = new Map();
const playerSockets = new Map(); // socket.id -> {gameCode, playerId}

function generateGameCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

class MultiplayerGame {
    constructor(gameCode) {
        this.gameCode = gameCode;
        this.players = [];
        this.gameStarted = false;
        
        // Game state (copied from original Game class)
        this.currentRound = 1;
        this.phase = 'waiting';
        this.deck = [];
        this.hands = {};
        this.bids = {};
        this.currentBidder = 0;
        this.highestBid = 6;
        this.highestBidder = null;
        this.trumpSuit = null;
        this.trumpCardRequest = null;
        this.teams = {};
        this.currentTrick = [];
        this.tricksWon = {};
        this.scores = {};
        this.currentPlayer = 0;
        this.passes = new Set();
        this.leadSuit = null;
        this.selectedPartnerCard = null;
        this.firstCardPlayed = false;
        this.waitingForPartner = false;
        this.partnerId = null;
        this.dealingInProgress = false;
        this.trickWinner = null;
        
        // Add sequence number for debugging
        this.stateSequence = 0;
    }

    addPlayer(socketId, playerName) {
        if (this.players.length >= 4 || this.gameStarted) {
            return false;
        }

        const playerId = this.players.length;
        const player = {
            id: playerId,
            name: playerName,
            socketId: socketId,
            connected: true  // Track connection status
        };

        this.players.push(player);
        
        // Initialize scores and tricks
        this.scores[playerId] = 0;
        this.tricksWon[playerId] = 0;

        console.log(`Player ${playerId} (${playerName}) added to game ${this.gameCode}`);
        return playerId;
    }

    removePlayer(socketId) {
        const playerIndex = this.players.findIndex(p => p.socketId === socketId);
        if (playerIndex !== -1) {
            this.players[playerIndex].connected = false;
            console.log(`Player ${playerIndex} disconnected from game ${this.gameCode}`);
            // Don't actually remove player, just mark as disconnected
            // They can rejoin with the same ID
        }
    }

    // New method to handle player rejoining
    rejoinPlayer(socketId, playerId) {
        if (playerId >= 0 && playerId < this.players.length) {
            this.players[playerId].socketId = socketId;
            this.players[playerId].connected = true;
            console.log(`Player ${playerId} rejoined game ${this.gameCode}`);
            return true;
        }
        return false;
    }

    canStart() {
        return this.players.length === 4 && !this.gameStarted && 
               this.players.every(p => p.connected);
    }

    createDeck() {
        const suits = ['hearts', 'diamonds', 'clubs', 'spades'];
        const deck = [];
        for (const suit of suits) {
            for (let rank = 2; rank <= 14; rank++) {
                deck.push({suit, rank});
            }
        }
        // Shuffle deck
        for (let i = deck.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [deck[i], deck[j]] = [deck[j], deck[i]];
        }
        return deck;
    }

    async startGame() {
        if (!this.canStart()) return false;
        
        this.gameStarted = true;
        this.deck = this.createDeck();
        await this.dealCards();
        this.startBidding();
        console.log(`Game ${this.gameCode} started with players:`, this.players.map(p => `${p.id}:${p.name}`));
        return true;
    }

    async dealCards() {
        this.dealingInProgress = true;
        this.hands = {0: [], 1: [], 2: [], 3: []};

        // Deal cards
        for (let cardIndex = 0; cardIndex < 13; cardIndex++) {
            for (let playerId = 0; playerId < 4; playerId++) {
                const card = this.deck.pop();
                this.hands[playerId].push(card);
            }
        }

        // Sort hands after dealing
        Object.keys(this.hands).forEach(playerId => {
            this.hands[playerId].sort((a, b) => {
                if (a.suit !== b.suit) {
                    const suitOrder = ['diamonds', 'spades', 'hearts', 'clubs'];
                    return suitOrder.indexOf(a.suit) - suitOrder.indexOf(b.suit);
                }
                return a.rank - b.rank;
            });
        });

        this.dealingInProgress = false;
        console.log(`Cards dealt for game ${this.gameCode}`);
    }

    startBidding() {
        this.phase = 'bidding';
        this.currentBidder = 0;
        this.bids = {};
        this.passes = new Set();
        this.highestBid = 6;
        this.highestBidder = null;
        console.log(`Bidding started for game ${this.gameCode}, first bidder: ${this.currentBidder}`);
    }

    makeBid(playerId, bid) {
        console.log(`Player ${playerId} attempting bid ${bid}. Current bidder: ${this.currentBidder}, dealing: ${this.dealingInProgress}`);
        
        if (playerId !== this.currentBidder || this.dealingInProgress) {
            console.log(`Bid rejected: wrong player or dealing in progress`);
            return false;
        }

        if (bid === 'pass') {
            this.passes.add(playerId);
            console.log(`Player ${playerId} passed`);
        } else if (bid > this.highestBid && bid >= 7 && bid <= 13) {
            this.bids[playerId] = bid;
            this.highestBid = bid;
            this.highestBidder = playerId;
            console.log(`Player ${playerId} bid ${bid} (new highest)`);
        } else {
            console.log(`Invalid bid ${bid} from player ${playerId}`);
            return false;
        }

        // Move to next bidder
        const oldBidder = this.currentBidder;
        this.currentBidder = (this.currentBidder + 1) % 4;
        console.log(`Bidder changed from ${oldBidder} to ${this.currentBidder}`);

        // Check if bidding is complete
        if (this.passes.size >= 3 || (Object.keys(this.bids).length + this.passes.size) >= 4) {
            if (this.highestBidder !== null) {
                this.phase = 'playing';
                this.currentPlayer = this.highestBidder;
                this.firstCardPlayed = false;
                console.log(`Bidding complete, winner: ${this.highestBidder} with ${this.highestBid}`);
            } else {
                // All passed, redeal
                console.log(`All passed, redealing...`);
                this.deck = this.createDeck();
                this.dealCards().then(() => {
                    this.startBidding();
                });
                return true;
            }
        }

        // Increment state sequence for debugging
        this.stateSequence++;
        return true;
    }

    selectPartnerCard(cardData) {
        this.selectedPartnerCard = cardData;
        this.trumpCardRequest = cardData;

        // Find partner based on requested card
        let partnerId = null;
        for (const playerId of Object.keys(this.hands)) {
            if (parseInt(playerId) !== this.highestBidder) {
                for (const card of this.hands[playerId]) {
                    if (card.suit === cardData.suit && card.rank === cardData.rank) {
                        partnerId = parseInt(playerId);
                        break;
                    }
                }
                if (partnerId !== null) break;
            }
        }

        // Set up teams
        this.teams = {};
        if (partnerId !== null) {
            this.teams[this.highestBidder] = 'bidder';
            this.teams[partnerId] = 'partner';
            this.partnerId = partnerId;
            this.waitingForPartner = true;
            for (const player of this.players) {
                if (!(player.id in this.teams)) {
                    this.teams[player.id] = 'opponent';
                }
            }
        } else {
            // If no partner found, bidder plays alone against all
            this.teams[this.highestBidder] = 'bidder';
            for (const player of this.players) {
                if (player.id !== this.highestBidder) {
                    this.teams[player.id] = 'opponent';
                }
            }
        }

        this.phase = 'playing';
        this.currentPlayer = (this.currentPlayer + 1) % 4;
        this.stateSequence++;
    }

    hasRequestedCard(playerId) {
        if (!this.trumpCardRequest) return false;
        return this.hands[playerId].some(card => 
            card.suit === this.trumpCardRequest.suit && 
            card.rank === this.trumpCardRequest.rank
        );
    }

    playCard(playerId, cardData) {
        if (playerId !== this.currentPlayer || this.dealingInProgress) return false;

        // Block card playing during partner selection phase
        if (this.phase === 'partner_selection') {
            return false;
        }

        // Check if partner must play requested card
        if (this.waitingForPartner && 
            playerId === this.partnerId && 
            this.hasRequestedCard(playerId)) {
            
            // Partner must play the requested card if they have it
            if (cardData.suit !== this.trumpCardRequest.suit || 
                cardData.rank !== this.trumpCardRequest.rank) {
                return false; // Invalid play - must play requested card
            }
        }

        // Find and remove card from player's hand
        let cardToPlay = null;
        for (let i = 0; i < this.hands[playerId].length; i++) {
            const card = this.hands[playerId][i];
            if (card.suit === cardData.suit && card.rank === cardData.rank) {
                cardToPlay = this.hands[playerId].splice(i, 1)[0];
                break;
            }
        }

        if (!cardToPlay) return false;

        // If this is the first card played by the bidder, set trump suit
        if (!this.firstCardPlayed && playerId === this.highestBidder) {
            this.trumpSuit = cardToPlay.suit;
            this.firstCardPlayed = true;
            this.leadSuit = cardToPlay.suit;
            
            this.currentTrick.push({
                playerId: playerId,
                card: cardToPlay,
                playerName: this.players[playerId].name
            });

            this.phase = 'partner_selection';
            this.stateSequence++;
            return true;
        }

        // If we're waiting for partner to play the requested card
        if (this.waitingForPartner && 
            this.trumpCardRequest && 
            playerId === this.partnerId &&
            cardToPlay.suit === this.trumpCardRequest.suit && 
            cardToPlay.rank === this.trumpCardRequest.rank) {
            
            this.waitingForPartner = false;
        }

        // Validate play (must follow suit if possible)
        if (this.currentTrick.length > 0) {
            if (this.leadSuit && this.hasSuit(playerId, this.leadSuit)) {
                if (cardToPlay.suit !== this.leadSuit) {
                    // Invalid play - put card back
                    this.hands[playerId].push(cardToPlay);
                    this.sortHand(playerId);
                    return false;
                }
            }
        } else {
            this.leadSuit = cardToPlay.suit;
        }

        this.currentTrick.push({
            playerId: playerId,
            card: cardToPlay,
            playerName: this.players[playerId].name
        });

        this.currentPlayer = (this.currentPlayer + 1) % 4;

        // Check if trick is complete
        if (this.currentTrick.length === 4) {
            this.completeTrick();
        }

        this.stateSequence++;
        return true;
    }

    sortHand(playerId) {
        this.hands[playerId].sort((a, b) => {
            if (a.suit !== b.suit) {
                const suitOrder = ['diamonds', 'spades', 'hearts', 'clubs'];
                return suitOrder.indexOf(a.suit) - suitOrder.indexOf(b.suit);
            }
            return a.rank - b.rank;
        });
    }

    hasSuit(playerId, suit) {
        return this.hands[playerId].some(card => card.suit === suit);
    }

    completeTrick() {
        // Determine winner
        let winnerPlay = this.currentTrick[0];

        for (let i = 1; i < this.currentTrick.length; i++) {
            const play = this.currentTrick[i];
            const card = play.card;
            const winnerCard = winnerPlay.card;

            // Trump beats everything
            if (card.suit === this.trumpSuit && winnerCard.suit !== this.trumpSuit) {
                winnerPlay = play;
            } else if (card.suit === this.trumpSuit && winnerCard.suit === this.trumpSuit) {
                if (card.rank > winnerCard.rank) {
                    winnerPlay = play;
                }
            } else if (winnerCard.suit !== this.trumpSuit && card.suit === this.leadSuit && winnerCard.suit === this.leadSuit) {
                if (card.rank > winnerCard.rank) {
                    winnerPlay = play;
                }
            } else if (winnerCard.suit !== this.trumpSuit && winnerCard.suit !== this.leadSuit && card.suit === this.leadSuit) {
                winnerPlay = play;
            }
        }

        // Award trick
        this.tricksWon[winnerPlay.playerId]++;

        // Set next starter
        this.currentPlayer = winnerPlay.playerId;

        // Show trick result for 3 seconds before clearing
        this.phase = 'trick_complete';
        this.trickWinner = winnerPlay;
        this.stateSequence++;
        
        // Broadcast the trick completion state
        this.broadcastGameState();

        // Wait 5 seconds before clearing the trick
        setTimeout(() => {
            // Reset for next trick
            this.currentTrick = [];
            this.leadSuit = null;
            this.phase = 'playing';
            this.trickWinner = null;

            // Check if round is complete
            if (Object.values(this.hands).every(hand => hand.length === 0)) {
                this.completeRound();
            } else {
                this.stateSequence++;
                this.broadcastGameState();
            }
        }, 5000);
    }

    completeRound() {
        // Calculate scores - combine tricks for bidding team
        let biddingTeamTricks = 0;
        if (this.highestBidder in this.teams) {
            for (const [playerId, team] of Object.entries(this.teams)) {
                if (team === 'bidder' || team === 'partner') {
                    biddingTeamTricks += this.tricksWon[parseInt(playerId)];
                }
            }
        }

        // Award points
        if (biddingTeamTricks >= this.highestBid) {
            // Bidding team succeeded - both get positive points
            for (const [playerId, team] of Object.entries(this.teams)) {
                if (team === 'bidder' || team === 'partner') {
                    this.scores[parseInt(playerId)] += this.highestBid;
                }
            }
            // Opponents get points for their individual tricks
            for (const [playerId, team] of Object.entries(this.teams)) {
                if (team === 'opponent') {
                    this.scores[parseInt(playerId)] += this.tricksWon[parseInt(playerId)];
                }
            }
        } else {
            // Bidding team failed - get negative points
            for (const [playerId, team] of Object.entries(this.teams)) {
                if (team === 'bidder' || team === 'partner') {
                    this.scores[parseInt(playerId)] -= this.highestBid;
                }
            }
            // Opponents get points for their individual tricks
            for (const [playerId, team] of Object.entries(this.teams)) {
                if (team === 'opponent') {
                    this.scores[parseInt(playerId)] += this.tricksWon[parseInt(playerId)];
                }
            }
        }

        this.phase = 'round_end';
        this.stateSequence++;
    }

    async startNextRound() {
        this.currentRound++;
        // Reset for next round
        this.deck = this.createDeck();
        this.tricksWon = {};
        this.players.forEach(player => {
            this.tricksWon[player.id] = 0;
        });
        this.teams = {};
        this.currentTrick = [];
        this.trumpSuit = null;
        this.trumpCardRequest = null;
        this.selectedPartnerCard = null;
        this.firstCardPlayed = false;
        this.waitingForPartner = false;
        this.partnerId = null;
        this.trickWinner = null;
        
        await this.dealCards();
        this.startBidding();
        this.stateSequence++;
    }

    getGameStateForPlayer(playerId) {
        // Return game state with only this player's cards visible
        const otherPlayerHands = {};
        for (let i = 0; i < 4; i++) {
            if (i === playerId) {
                otherPlayerHands[i] = this.hands[i]; // Full hand for this player
            } else {
                // Show hidden cards for other players (so you can see card backs)
                // Make sure to preserve the array length so UI shows correct number of cards
                if (this.hands[i]) {
                    otherPlayerHands[i] = this.hands[i].map(() => ({
                        hidden: true,
                        suit: 'hidden',
                        rank: 0
                    }));
                } else {
                    otherPlayerHands[i] = [];
                }
            }
        }

        return {
            gameCode: this.gameCode,
            players: this.players,
            currentRound: this.currentRound,
            phase: this.phase,
            hands: otherPlayerHands,
            bids: this.bids,
            currentBidder: this.currentBidder,
            highestBid: this.highestBid,
            highestBidder: this.highestBidder,
            trumpSuit: this.trumpSuit,
            trumpCardRequest: this.trumpCardRequest,
            teams: this.teams,
            currentTrick: this.currentTrick,
            tricksWon: this.tricksWon,
            scores: this.scores,
            currentPlayer: this.currentPlayer,
            passes: Array.from(this.passes),
            leadSuit: this.leadSuit,
            selectedPartnerCard: this.selectedPartnerCard,
            firstCardPlayed: this.firstCardPlayed,
            waitingForPartner: this.waitingForPartner,
            partnerId: this.partnerId,
            dealingInProgress: this.dealingInProgress,
            playerId: playerId,
            stateSequence: this.stateSequence,
            trickWinner: this.trickWinner
        };
    }

    // Add method to broadcast state to all connected players
    broadcastGameState() {
        this.players.forEach(player => {
            if (player.connected) {
                const socket = io.sockets.sockets.get(player.socketId);
                if (socket) {
                    socket.emit('gameUpdated', this.getGameStateForPlayer(player.id));
                }
            }
        });
    }
}

// Socket.IO connection handling
io.on('connection', (socket) => {
    console.log('Player connected:', socket.id);

    socket.on('createGame', (playerName) => {
        console.log(`${socket.id} creating game with name: ${playerName}`);
        const gameCode = generateGameCode();
        const game = new MultiplayerGame(gameCode);
        
        const playerId = game.addPlayer(socket.id, playerName);
        if (playerId !== false) {
            games.set(gameCode, game);
            playerSockets.set(socket.id, {gameCode, playerId});
            
            socket.join(gameCode);
            socket.emit('gameCreated', {gameCode, playerId});
            
            // Broadcast updated lobby to all players in the game
            io.to(gameCode).emit('lobbyUpdated', {
                players: game.players,
                canStart: game.canStart()
            });
        }
    });

    socket.on('joinGame', ({gameCode, playerName}) => {
        console.log(`${socket.id} joining game ${gameCode} with name: ${playerName}`);
        const game = games.get(gameCode);
        
        if (!game) {
            socket.emit('error', 'Game not found');
            return;
        }

        const playerId = game.addPlayer(socket.id, playerName);
        if (playerId !== false) {
            playerSockets.set(socket.id, {gameCode, playerId});
            socket.join(gameCode);
            
            socket.emit('gameJoined', {gameCode, playerId});
            
            // Broadcast updated lobby to all players in the game
            io.to(gameCode).emit('lobbyUpdated', {
                players: game.players,
                canStart: game.canStart()
            });
        } else {
            socket.emit('error', 'Cannot join game (full or already started)');
        }
    });

    socket.on('startGame', () => {
        const playerInfo = playerSockets.get(socket.id);
        if (!playerInfo) {
            console.log('No player info found for startGame');
            return;
        }

        const game = games.get(playerInfo.gameCode);
        if (!game) {
            console.log('No game found for startGame');
            return;
        }

        console.log('Starting game:', playerInfo.gameCode, 'Players:', game.players.length);

        if (game.startGame()) {
            console.log('Game started successfully');
            // Use the new broadcast method
            game.broadcastGameState();
            
            // Also send specific start event
            game.players.forEach(player => {
                const playerSocket = io.sockets.sockets.get(player.socketId);
                if (playerSocket) {
                    playerSocket.emit('gameStarted', game.getGameStateForPlayer(player.id));
                }
            });
        } else {
            console.log('Failed to start game');
            socket.emit('error', 'Could not start game');
        }
    });

    socket.on('makeBid', (bid) => {
        const playerInfo = playerSockets.get(socket.id);
        if (!playerInfo) {
            console.log('No player info found for socket:', socket.id);
            socket.emit('error', 'Player not found');
            return;
        }

        const game = games.get(playerInfo.gameCode);
        if (!game) {
            console.log('No game found for code:', playerInfo.gameCode);
            socket.emit('error', 'Game not found');
            return;
        }

        console.log(`Player ${playerInfo.playerId} attempting to bid ${bid}. Current bidder: ${game.currentBidder}`);
        
        if (game.makeBid(playerInfo.playerId, bid)) {
            console.log(`Bid successful. New current bidder: ${game.currentBidder}`);
            
            // Use the improved broadcast method
            setTimeout(() => {
                game.broadcastGameState();
            }, 50); // Small delay to ensure state is consistent

            // Send special popup messages
            if (bid === 7) {
                io.to(playerInfo.gameCode).emit('showPopup', 'PUSSY ASS BITCH');
            } else if (bid === 8 && game.highestBidder === playerInfo.playerId) {
                io.to(playerInfo.gameCode).emit('showPopup', 'LUTFATTIG');
            }
        } else {
            console.log('Bid failed');
            socket.emit('error', 'Invalid bid');
        }
    });

    socket.on('selectPartnerCard', (cardData) => {
        const playerInfo = playerSockets.get(socket.id);
        if (!playerInfo) return;

        const game = games.get(playerInfo.gameCode);
        if (!game || playerInfo.playerId !== game.highestBidder) return;

        game.selectPartnerCard(cardData);
        
        // Use improved broadcast
        game.broadcastGameState();
    });

    socket.on('playCard', (cardData) => {
        const playerInfo = playerSockets.get(socket.id);
        if (!playerInfo) return;

        const game = games.get(playerInfo.gameCode);
        if (!game) return;

        if (game.playCard(playerInfo.playerId, cardData)) {
            // Use improved broadcast
            game.broadcastGameState();

            // Check for round end popup
            if (game.phase === 'round_end') {
                const biddingTeamTricks = Object.entries(game.teams)
                    .filter(([playerId, team]) => team === 'bidder' || team === 'partner')
                    .reduce((sum, [playerId]) => sum + game.tricksWon[parseInt(playerId)], 0);
                
                if (biddingTeamTricks < game.highestBid) {
                    io.to(playerInfo.gameCode).emit('showPopup', 'DØDSKLEINT');
                }
            }
        }
    });

    socket.on('startNextRound', () => {
        const playerInfo = playerSockets.get(socket.id);
        if (!playerInfo) return;

        const game = games.get(playerInfo.gameCode);
        if (!game) return;

        game.startNextRound().then(() => {
            // Use improved broadcast
            game.broadcastGameState();
        });
    });

    socket.on('rejoinGame', ({gameCode, playerId}) => {
        console.log(`Player ${playerId} attempting to rejoin game ${gameCode}`);
        const game = games.get(gameCode);
        if (!game) {
            socket.emit('error', 'Game not found');
            return;
        }

        // Use the new rejoin method
        if (game.rejoinPlayer(socket.id, playerId)) {
            // Update the playerSockets mapping
            playerSockets.set(socket.id, {gameCode, playerId});
            
            socket.join(gameCode);
            console.log(`Player ${playerId} rejoined game ${gameCode} successfully`);
            
            // Send current game state
            socket.emit('gameUpdated', game.getGameStateForPlayer(playerId));
        } else {
            console.log(`Player ${playerId} not found in game ${gameCode}`);
            socket.emit('error', 'Player not found in game');
        }
    });

    socket.on('disconnect', () => {
        console.log('Player disconnected:', socket.id);
        
        const playerInfo = playerSockets.get(socket.id);
        if (playerInfo) {
            const game = games.get(playerInfo.gameCode);
            if (game) {
                game.removePlayer(socket.id);
                
                // If no connected players left, delete the game after a delay
                const connectedPlayers = game.players.filter(p => p.connected).length;
                if (connectedPlayers === 0) {
                    setTimeout(() => {
                        const updatedGame = games.get(playerInfo.gameCode);
                        if (updatedGame && updatedGame.players.filter(p => p.connected).length === 0) {
                            games.delete(playerInfo.gameCode);
                            console.log(`Game ${playerInfo.gameCode} deleted due to no connected players`);
                        }
                    }, 30000); // Give 30 seconds for reconnection
                } else {
                    // Broadcast updated game state for remaining players
                    if (!game.gameStarted) {
                        io.to(playerInfo.gameCode).emit('lobbyUpdated', {
                            players: game.players.filter(p => p.connected),
                            canStart: game.canStart()
                        });
                    } else {
                        io.to(playerInfo.gameCode).emit('playerDisconnected', playerInfo.playerId);
                    }
                }
            }
            
            playerSockets.delete(socket.id);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});