class MultiplayerGameClient {
    constructor() {
        this.socket = io();
        this.gameState = null;
        this.playerId = null;
        this.lastStateSequence = -1; // Track state updates
        this.pendingActions = new Set(); // Track pending actions
        
        this.initializeFromStorage();
        this.setupSocketListeners();
        this.setupEventListeners();
    }

    initializeFromStorage() {
        const storedGameState = localStorage.getItem('gameState');
        const storedPlayerInfo = localStorage.getItem('playerInfo');
        
        if (!storedGameState || !storedPlayerInfo) {
            console.log('No game state or player info found, redirecting to lobby');
            window.location.href = 'lobby.html';
            return;
        }

        this.gameState = JSON.parse(storedGameState);
        const playerInfo = JSON.parse(storedPlayerInfo);
        
        this.playerId = playerInfo.playerId;
        this.gameCode = playerInfo.gameCode;
        this.playerName = playerInfo.playerName;
        
        console.log('Initializing game client:', {
            playerId: this.playerId,
            gameCode: this.gameCode,
            playerName: this.playerName
        });
        
        // Display game code
        document.getElementById('display-game-code').textContent = this.gameCode;
        
        // Wait for socket connection before rejoining
        if (this.socket.connected) {
            this.rejoinGame();
        } else {
            this.socket.once('connect', () => {
                this.rejoinGame();
            });
        }
        
        this.updateDisplay();
        
        // Clean up storage
        localStorage.removeItem('gameState');
        localStorage.removeItem('playerInfo');
    }

    rejoinGame() {
        console.log('Rejoining game:', this.gameCode, 'as player:', this.playerId);
        this.socket.emit('rejoinGame', {
            gameCode: this.gameCode,
            playerId: this.playerId
        });
    }

    setupSocketListeners() {
        this.socket.on('gameUpdated', (newGameState) => {
            console.log('Received game update, sequence:', newGameState.stateSequence, 'last:', this.lastStateSequence);
            
            // Check if round just ended
            const wasNotRoundEnd = this.gameState?.phase !== 'round_end';
            const isNowRoundEnd = newGameState.phase === 'round_end';
            
            // Only update if this is a newer state (prevent out-of-order updates)
            if (newGameState.stateSequence > this.lastStateSequence) {
                this.gameState = newGameState;
                this.lastStateSequence = newGameState.stateSequence;
                this.updateDisplay();
                
                // Update highscores when round ends
                if (wasNotRoundEnd && isNowRoundEnd && this.playerName) {
                    const myScore = this.gameState.scores[this.playerId] || 0;
                    this.updateHighscore(this.playerName, myScore);
                }
                
                // Clear any pending actions for this player's turn
                if (newGameState.currentBidder !== this.playerId && newGameState.currentPlayer !== this.playerId) {
                    this.pendingActions.clear();
                }
            }
        });

        this.socket.on('gameStarted', (gameState) => {
            console.log('Game started, received initial state');
            this.gameState = gameState;
            this.lastStateSequence = gameState.stateSequence || 0;
            this.updateDisplay();
        });

        this.socket.on('showPopup', (message) => {
            this.showPopupMessage(message);
        });

        this.socket.on('playerDisconnected', (playerId) => {
            this.showPopupMessage(`Spiller ${this.gameState.players[playerId]?.name || playerId + 1} koblet fra`);
        });

        this.socket.on('error', (message) => {
            console.error('Socket error:', message);
            this.showPopupMessage(`Feil: ${message}`);
            // Clear pending actions on error
            this.pendingActions.clear();
            this.updateDisplay();
        });

        this.socket.on('disconnect', () => {
            this.showPopupMessage('Mistet tilkobling til server');
            console.log('Disconnected from server');
        });

        this.socket.on('connect', () => {
            console.log('Connected to server');
            // Clear pending actions on reconnect
            this.pendingActions.clear();
            
            // Rejoin the game room when reconnecting
            if (this.gameState && this.gameState.gameCode) {
                this.socket.emit('rejoinGame', {
                    gameCode: this.gameState.gameCode,
                    playerId: this.playerId
                });
            }
        });
    }

    setupEventListeners() {
        // Bidding buttons
        document.querySelectorAll('.bid-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const bid = parseInt(btn.dataset.bid);
                this.makeBid(bid);
            });
        });

        document.querySelector('.pass-btn').addEventListener('click', () => {
            this.makeBid('pass');
        });

        // Partner selection confirmation
        document.getElementById('confirm-partner').addEventListener('click', () => {
            if (this.selectedPartnerCard) {
                this.socket.emit('selectPartnerCard', this.selectedPartnerCard);
            }
        });

        // Round end controls
        document.getElementById('next-round').addEventListener('click', () => {
            this.socket.emit('startNextRound');
        });

        document.getElementById('leave-game').addEventListener('click', () => {
            window.location.href = 'lobby.html';
        });
    }

    makeBid(bid) {
        console.log('Attempting to make bid:', bid, 'Current bidder:', this.gameState?.currentBidder, 'My ID:', this.playerId);
        
        if (!this.gameState) {
            console.log('No game state available');
            return;
        }

        // Check if it's really this player's turn
        if (this.gameState.currentBidder !== this.playerId) {
            console.log('Not my turn to bid');
            this.showPopupMessage('Det er ikke din tur!');
            return;
        }

        // Check if we already have a pending bid action
        const actionKey = `bid_${bid}`;
        if (this.pendingActions.has(actionKey)) {
            console.log('Bid already pending');
            return;
        }

        // Add to pending actions
        this.pendingActions.add(actionKey);
        
        console.log('Sending bid to server:', bid);
        this.socket.emit('makeBid', bid);
        
        // Remove from pending after a timeout (in case of network issues)
        setTimeout(() => {
            this.pendingActions.delete(actionKey);
        }, 5000);
    }

    showPopupMessage(message) {
        const popup = document.getElementById('popup-message');
        const popupText = document.getElementById('popup-text');
        
        popupText.textContent = message;
        popup.classList.remove('hidden');
        popup.classList.add('show');
        
        setTimeout(() => {
            popup.classList.add('hidden');
            popup.classList.remove('show');
        }, 2000);
    }

    updateDisplay() {
        if (!this.gameState) {
            console.log('No game state to display');
            return;
        }

        console.log('Updating display with state sequence:', this.gameState.stateSequence);
        
        this.updatePhaseIndicator();
        this.updateGameInfo();
        this.updatePlayerHands();
        this.updateControls();
        this.updateTrickArea();
        this.updatePlayerStats();
    }

    updatePhaseIndicator() {
        const indicator = document.getElementById('phase-indicator');
        const phaseNames = {
            'bidding': 'Budgivning',
            'partner_selection': 'Velg partner',
            'playing': 'Spilling',
            'trick_complete': 'Stikk ferdig',
            'round_end': 'Runde ferdig'
        };
        indicator.textContent = phaseNames[this.gameState.phase] || this.gameState.phase;
    }

    updateGameInfo() {
        document.getElementById('trump-display').textContent = this.gameState.trumpSuit ? 
            this.getSuitName(this.gameState.trumpSuit) : '-';
        document.getElementById('highest-bid').textContent = this.gameState.highestBidder !== null ? 
            this.gameState.highestBid : '-';
        document.getElementById('current-round').textContent = this.gameState.currentRound;
    }

    updatePlayerHands() {
        for (let playerId = 0; playerId < 4; playerId++) {
            const handContainer = document.querySelector(`[data-player="${playerId}"]`);
            handContainer.innerHTML = '';
            
            if (this.gameState.hands[playerId]) {
                this.gameState.hands[playerId].forEach((card, index) => {
                    const cardElement = this.createCardElement(card, playerId);
                    cardElement.style.animationDelay = `${index * 0.05}s`;
                    handContainer.appendChild(cardElement);
                });
            }
            
            // Clear all highlighting first
            const playerSection = document.getElementById(`player-${playerId}`);
            playerSection.classList.remove('current-player', 'current-bidder', 'team-bidder', 'team-partner', 'team-opponent');
            
            // Update player name
            const playerNameElement = playerSection.querySelector('.player-name');
            if (this.gameState.players[playerId]) {
                playerNameElement.textContent = this.gameState.players[playerId].name;
                if (playerId === this.playerId) {
                    playerNameElement.textContent += ' (Du)';
                }
            }
            
            // Highlight current player or bidder based on phase
            if (this.gameState.phase === 'bidding' && this.gameState.currentBidder === playerId) {
                playerSection.classList.add('current-bidder');
            } else if ((this.gameState.phase === 'playing' || this.gameState.phase === 'partner_selection') && this.gameState.currentPlayer === playerId) {
                playerSection.classList.add('current-player');
            }
            
            // Add team styling
            if (this.gameState.teams[playerId]) {
                if (this.gameState.teams[playerId] === 'bidder') {
                    playerSection.classList.add('team-bidder');
                } else if (this.gameState.teams[playerId] === 'partner') {
                    playerSection.classList.add('team-partner');
                } else if (this.gameState.teams[playerId] === 'opponent') {
                    playerSection.classList.add('team-opponent');
                }
            }
        }
        
        // Update team indicators
        this.updateTeamIndicators();
    }

    updateTeamIndicators() {
        for (let playerId = 0; playerId < 4; playerId++) {
            const indicator = document.getElementById(`team-indicator-${playerId}`);
            if (this.gameState.teams[playerId]) {
                indicator.classList.remove('hidden');
                indicator.classList.remove('bidder', 'partner', 'opponent');
                
                if (this.gameState.teams[playerId] === 'bidder') {
                    indicator.textContent = 'Budgiver';
                    indicator.classList.add('bidder');
                } else if (this.gameState.teams[playerId] === 'partner') {
                    indicator.textContent = 'Partner';
                    indicator.classList.add('partner');
                } else if (this.gameState.teams[playerId] === 'opponent') {
                    indicator.textContent = 'Motstander';
                    indicator.classList.add('opponent');
                }
            } else {
                indicator.classList.add('hidden');
            }
        }
    }

    updateControls() {
        // Hide all controls
        document.getElementById('bidding-controls').classList.add('hidden');
        document.getElementById('partner-controls').classList.add('hidden');
        document.getElementById('round-end-controls').classList.add('hidden');

        if (this.gameState.phase === 'bidding') {
            document.getElementById('bidding-controls').classList.remove('hidden');
            const currentBidderName = this.gameState.players[this.gameState.currentBidder]?.name || `Spiller ${this.gameState.currentBidder + 1}`;
            document.getElementById('current-bidder').textContent = currentBidderName;
            this.updateBidButtons();
        } else if (this.gameState.phase === 'partner_selection' && this.playerId === this.gameState.highestBidder) {
            document.getElementById('partner-controls').classList.remove('hidden');
            const winnerName = this.gameState.players[this.gameState.highestBidder]?.name || `Spiller ${this.gameState.highestBidder + 1}`;
            document.getElementById('partner-winner').textContent = winnerName;
            document.getElementById('trump-suit-display').textContent = this.getSuitName(this.gameState.trumpSuit);
            this.showPartnerSelection();
        } else if (this.gameState.phase === 'playing') {
            // Show partner warning if applicable
            const warning = document.getElementById('partner-card-warning');
            if (this.gameState.waitingForPartner && 
                this.gameState.currentPlayer === this.gameState.partnerId && 
                this.hasRequestedCard(this.gameState.partnerId)) {
                warning.classList.remove('hidden');
                const rankNames = {14: 'A', 13: 'K', 12: 'Q', 11: 'J'};
                const rankDisplay = rankNames[this.gameState.trumpCardRequest.rank] || this.gameState.trumpCardRequest.rank.toString();
                const suitSymbol = this.getSuitSymbol(this.gameState.trumpCardRequest.suit);
                document.getElementById('requested-card-display').textContent = `${rankDisplay}${suitSymbol}`;
            } else {
                warning.classList.add('hidden');
            }
        } else if (this.gameState.phase === 'round_end') {
            document.getElementById('round-end-controls').classList.remove('hidden');
            this.updateRoundResults();
        }
    }

    updateBidButtons() {
        const bidButtons = document.querySelectorAll('.bid-btn');
        const passButton = document.querySelector('.pass-btn');
        const isMyTurn = this.gameState.currentBidder === this.playerId;
        
        // Check for pending actions
        const hasPendingBid = Array.from(this.pendingActions).some(action => action.startsWith('bid_'));
        
        bidButtons.forEach(btn => {
            const bidValue = parseInt(btn.dataset.bid);
            const canBid = bidValue > this.gameState.highestBid && isMyTurn && !hasPendingBid;
            btn.disabled = !canBid;
            
            // Visual feedback
            if (isMyTurn && !hasPendingBid) {
                btn.style.opacity = canBid ? '1' : '0.5';
            } else {
                btn.style.opacity = '0.5';
            }
        });
        
        // Pass button
        passButton.disabled = !isMyTurn || hasPendingBid;
        passButton.style.opacity = (isMyTurn && !hasPendingBid) ? '1' : '0.5';
        
        // Add visual indication if it's this player's turn
        const biddingControls = document.getElementById('bidding-controls');
        if (isMyTurn && !hasPendingBid) {
            biddingControls.style.borderColor = '#4CAF50';
            biddingControls.style.borderWidth = '2px';
            biddingControls.style.borderStyle = 'solid';
        } else {
            biddingControls.style.border = 'none';
        }
        
        // Show loading state if there are pending actions
        if (hasPendingBid) {
            biddingControls.style.borderColor = '#FFC107';
            biddingControls.style.borderWidth = '2px';
            biddingControls.style.borderStyle = 'dashed';
        }
    }

    hasRequestedCard(playerId) {
        if (!this.gameState.trumpCardRequest) return false;
        return this.gameState.hands[playerId].some(card => 
            !card.hidden && 
            card.suit === this.gameState.trumpCardRequest.suit && 
            card.rank === this.gameState.trumpCardRequest.rank
        );
    }

    showPartnerSelection() {
        const container = document.getElementById('partner-card-buttons');
        container.innerHTML = '';

        // Get cards that the bidder doesn't have in the trump suit
        const bidderCards = this.gameState.hands[this.gameState.highestBidder];
        const bidderTrumpRanks = new Set(
            bidderCards
                .filter(card => !card.hidden && card.suit === this.gameState.trumpSuit)
                .map(card => card.rank)
        );

        // Create buttons for each rank in the trump suit that bidder doesn't have
        const ranks = [14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2];
        const rankNames = {14: 'A', 13: 'K', 12: 'Q', 11: 'J'};

        ranks.forEach(rank => {
            // Only show cards the bidder doesn't have
            if (!bidderTrumpRanks.has(rank)) {
                const button = document.createElement('button');
                button.className = 'partner-card-btn';
                button.dataset.rank = rank;
                button.dataset.suit = this.gameState.trumpSuit;
                
                const rankDisplay = rankNames[rank] || rank.toString();
                const suitSymbol = this.getSuitSymbol(this.gameState.trumpSuit);
                button.textContent = `${rankDisplay}${suitSymbol}`;
                
                button.addEventListener('click', () => {
                    // Clear previous selection
                    document.querySelectorAll('.partner-card-btn').forEach(b => b.classList.remove('selected'));
                    button.classList.add('selected');
                    this.selectedPartnerCard = {suit: this.gameState.trumpSuit, rank: rank};
                    document.getElementById('confirm-partner').classList.remove('hidden');
                });
                
                container.appendChild(button);
            }
        });
    }

    updateTrickArea() {
        const playedCardsContainer = document.getElementById('played-cards');
        const trickArea = document.querySelector('.trick-area');
        
        // Remove existing countdown if any
        const existingCountdown = document.querySelector('.trick-countdown');
        if (existingCountdown) {
            existingCountdown.remove();
        }
        
        // Handle trick completion phase
        if (this.gameState.phase === 'trick_complete') {
            trickArea.classList.add('complete');
            
            // Show winner message
            let winnerMessage = document.querySelector('.trick-winner-message');
            if (!winnerMessage) {
                winnerMessage = document.createElement('div');
                winnerMessage.className = 'trick-winner-message';
                trickArea.insertBefore(winnerMessage, playedCardsContainer);
            }
            
            const winnerName = this.gameState.trickWinner?.playerName || 'Ukjent';
            winnerMessage.textContent = `${winnerName} vant stikket!`;
            
            // Add countdown timer
            const countdown = document.createElement('div');
            countdown.className = 'trick-countdown';
            countdown.textContent = '3';
            trickArea.appendChild(countdown);
            
            let timeLeft = 3;
            const countdownInterval = setInterval(() => {
                timeLeft--;
                countdown.textContent = timeLeft;
                if (timeLeft <= 0) {
                    clearInterval(countdownInterval);
                    countdown.remove();
                }
            }, 1000);
            
        } else {
            trickArea.classList.remove('complete');
            // Remove winner message
            const winnerMessage = document.querySelector('.trick-winner-message');
            if (winnerMessage) {
                winnerMessage.remove();
            }
        }

        // Clear and rebuild played cards
        playedCardsContainer.innerHTML = '';

        this.gameState.currentTrick.forEach((play, index) => {
            const playedCardDiv = document.createElement('div');
            playedCardDiv.className = 'played-card';
            
            // Highlight winning card during trick completion
            if (this.gameState.phase === 'trick_complete' && 
                this.gameState.trickWinner && 
                play.playerId === this.gameState.trickWinner.playerId) {
                playedCardDiv.classList.add('winner');
            }

            const cardElement = this.createCardElement(play.card, null, false);
            const playerNameDiv = document.createElement('div');
            playerNameDiv.textContent = play.playerName;

            playedCardDiv.appendChild(playerNameDiv);
            playedCardDiv.appendChild(cardElement);
            playedCardsContainer.appendChild(playedCardDiv);
            
            // Stagger the card appearance animations
            playedCardDiv.style.animationDelay = `${index * 0.1}s`;
        });
    }

    updatePlayerStats() {
        for (let playerId = 0; playerId < 4; playerId++) {
            const playerSection = document.getElementById(`player-${playerId}`);
            const tricksSpan = playerSection.querySelector('.tricks');
            const scoreSpan = playerSection.querySelector('.score');
            
            tricksSpan.textContent = this.gameState.tricksWon[playerId] || 0;
            scoreSpan.textContent = this.gameState.scores[playerId] || 0;
        }
    }

    updateRoundResults() {
        const resultsElement = document.getElementById('round-results');
        let resultText = '';
        
        if (this.gameState.highestBidder !== null) {
            // Calculate combined tricks for bidding team
            let biddingTeamTricks = 0;
            for (const [playerId, team] of Object.entries(this.gameState.teams)) {
                if (team === 'bidder' || team === 'partner') {
                    biddingTeamTricks += this.gameState.tricksWon[parseInt(playerId)] || 0;
                }
            }
            
            const success = biddingTeamTricks >= this.gameState.highestBid;
            const bidderName = this.gameState.players[this.gameState.highestBidder]?.name || `Spiller ${this.gameState.highestBidder + 1}`;
            const partnerName = this.gameState.partnerId !== null ? 
                (this.gameState.players[this.gameState.partnerId]?.name || `Spiller ${this.gameState.partnerId + 1}`) : 'ingen';
            
            resultText = `${bidderName} (med ${partnerName}) budde ${this.gameState.highestBid} og tok ${biddingTeamTricks} stikk sammen. `;
            resultText += success ? 'Maktet!' : 'Feilet!';
            
            if (!success) {
                resultText += ` (-${this.gameState.highestBid} poeng)`;
            } else {
                resultText += ` (+${this.gameState.highestBid} poeng)`;
            }
        }
        
        resultsElement.textContent = resultText;
    }

    createCardElement(card, playerId, clickable = true) {
        const cardDiv = document.createElement('div');
        
        // Handle hidden cards (other players' cards)
        if (card.hidden) {
            cardDiv.className = 'card hidden';
            return cardDiv;
        }

        cardDiv.className = `card ${card.suit}`;

        // Special highlighting for partner's requested card
        if (this.gameState.waitingForPartner && 
            playerId === this.gameState.partnerId && 
            this.gameState.trumpCardRequest &&
            card.suit === this.gameState.trumpCardRequest.suit && 
            card.rank === this.gameState.trumpCardRequest.rank) {
            cardDiv.classList.add('forced');
        }

        // Only make cards clickable if it's this player's turn and they own the card
        if (clickable && 
            (this.gameState.phase === 'playing' || this.gameState.phase === 'partner_selection') && 
            playerId === this.gameState.currentPlayer &&
            playerId === this.playerId) {
            cardDiv.classList.add('playable');
            cardDiv.addEventListener('click', () => {
                this.playCardWithAnimation(card, cardDiv);
            });
        }

        const rankSymbols = {11: 'J', 12: 'Q', 13: 'K', 14: 'A'};
        const suitSymbols = {
            hearts: '♥',
            diamonds: '♦',
            clubs: '♣',
            spades: '♠'
        };

        const rankDisplay = rankSymbols[card.rank] || card.rank.toString();
        const suitDisplay = suitSymbols[card.suit] || card.suit;

        cardDiv.innerHTML = `
            <div class="card-rank">${rankDisplay}</div>
            <div class="card-suit">${suitDisplay}</div>
        `;

        return cardDiv;
    }

    // New method to handle card playing with animation
    playCardWithAnimation(card, cardElement) {
        // Get the card's current position
        const cardRect = cardElement.getBoundingClientRect();
        const trickArea = document.querySelector('.trick-area .played-cards');
        const trickRect = trickArea.getBoundingClientRect();
        
        // Create a clone for animation
        const animatedCard = cardElement.cloneNode(true);
        animatedCard.classList.add('playing');
        animatedCard.style.position = 'fixed';
        animatedCard.style.left = cardRect.left + 'px';
        animatedCard.style.top = cardRect.top + 'px';
        animatedCard.style.width = cardRect.width + 'px';
        animatedCard.style.height = cardRect.height + 'px';
        animatedCard.style.zIndex = '700';
        
        document.body.appendChild(animatedCard);
        
        // Hide the original card immediately
        cardElement.style.opacity = '0';
        
        // Calculate target position (center of trick area)
        const targetX = trickRect.left + (trickRect.width / 2) - (cardRect.width / 2);
        const targetY = trickRect.top + (trickRect.height / 2) - (cardRect.height / 2);
        
        // Animate to trick area
        requestAnimationFrame(() => {
            animatedCard.style.left = targetX + 'px';
            animatedCard.style.top = targetY + 'px';
            animatedCard.style.transform = 'scale(1.1)';
        });
        
        // Send the play after a short delay to allow animation to start
        setTimeout(() => {
            this.socket.emit('playCard', {suit: card.suit, rank: card.rank});
        }, 200);
        
        // Clean up the animated card after animation completes
        setTimeout(() => {
            if (document.body.contains(animatedCard)) {
                document.body.removeChild(animatedCard);
            }
        }, 800);
    }

    // Add method to update player highscore
    updateHighscore(playerName, gameScore) {
        const cookieName = `player_stats_${playerName}`;
        let stats = { gamesPlayed: 0, totalPoints: 0, bestGame: 0 };

        // Try to load existing stats
        const existingData = this.getCookie(cookieName);
        if (existingData) {
            try {
                stats = JSON.parse(decodeURIComponent(existingData));
            } catch (e) {
                console.error('Error parsing existing stats:', e);
            }
        }

        // Update stats
        stats.gamesPlayed += 1;
        stats.totalPoints += gameScore;
        if (gameScore > stats.bestGame) {
            stats.bestGame = gameScore;
        }

        // Save back to cookie (expires in 1 year)
        const expiryDate = new Date();
        expiryDate.setFullYear(expiryDate.getFullYear() + 1);
        
        document.cookie = `${cookieName}=${encodeURIComponent(JSON.stringify(stats))}; expires=${expiryDate.toUTCString()}; path=/`;
        
        console.log(`Updated highscore for ${playerName}:`, stats);
    }

    // Helper method to get cookie value
    getCookie(name) {
        const value = `; ${document.cookie}`;
        const parts = value.split(`; ${name}=`);
        if (parts.length === 2) {
            return parts.pop().split(';').shift();
        }
        return null;
    }

    getSuitName(suit) {
        const suitNames = {
            hearts: '♥️ Hjerter',
            diamonds: '♦️ Ruter',
            clubs: '♣️ Kløver',
            spades: '♠️ Spar'
        };
        return suitNames[suit] || suit;
    }

    getSuitSymbol(suit) {
        const symbols = {
            hearts: '♥',
            diamonds: '♦',
            clubs: '♣',
            spades: '♠'
        };
        return symbols[suit] || suit;
    }
}

// Initialize game client when page loads
document.addEventListener('DOMContentLoaded', () => {
    new MultiplayerGameClient();
});