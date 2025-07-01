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
            console.log('Received game update, sequence:', newGameState.stateSequence, 'last:', this.lastStateSequence, 'phase:', newGameState.phase);
            
            // Only update if this is a newer state (prevent out-of-order updates)
            if (newGameState.stateSequence > this.lastStateSequence) {
                this.gameState = newGameState;
                this.lastStateSequence = newGameState.stateSequence;
                this.updateDisplay();
                
                // Clear any pending actions if it's not this player's turn
                if (newGameState.phase === 'bidding' && newGameState.currentBidder !== this.playerId) {
                    this.pendingActions.clear();
                } else if ((newGameState.phase === 'playing' || newGameState.phase === 'partner_selection') && newGameState.currentPlayer !== this.playerId) {
                    this.pendingActions.clear();
                }
            }
        });

        this.socket.on('gameStarted', (gameState) => {
            console.log('Game started, received initial state, phase:', gameState.phase);
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
        console.log('Attempting to make bid:', bid, 'Current bidder:', this.gameState?.currentBidder, 'My ID:', this.playerId, 'Phase:', this.gameState?.phase);
        
        if (!this.gameState) {
            console.log('No game state available');
            return;
        }

        // Check if we're in bidding phase
        if (this.gameState.phase !== 'bidding') {
            console.log('Not in bidding phase, current phase:', this.gameState.phase);
            this.showPopupMessage('Ikke i budgivnings fase!');
            return;
        }

        // Check if it's really this player's turn
        if (this.gameState.currentBidder !== this.playerId) {
            console.log('Not my turn to bid, current bidder:', this.gameState.currentBidder);
            this.showPopupMessage('Det er ikke din tur!');
            return;
        }

        // Check if we already have a pending bid action
        const actionKey = `bid_${bid}`;
        if (this.pendingActions.has(actionKey)) {
            console.log('Bid already pending');
            return;
        }

        // Validate bid value
        if (bid !== 'pass' && (bid <= this.gameState.highestBid || bid < 7 || bid > 13)) {
            console.log('Invalid bid value:', bid, 'highest bid:', this.gameState.highestBid);
            this.showPopupMessage('Ugyldig bud!');
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

        console.log('Updating display with state sequence:', this.gameState.stateSequence, 'phase:', this.gameState.phase);
        
        this.updatePhaseIndicator();
        this.updateGameInfo();
        this.updatePlayerHands();
        this.updateControls();
        this.updateTrickArea();
    }

    updatePhaseIndicator() {
        const indicator = document.getElementById('phase-indicator');
        const phaseNames = {
            'waiting': 'Venter på spillere',
            'bidding': 'Budgivning',
            'trump_selection': 'Velg trumf',
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
        
        // Update team tricks display
        document.getElementById('team-tricks').textContent = this.getTeamTricksDisplay();
        
        document.getElementById('highest-bid').textContent = this.gameState.highestBidder !== null ? 
            this.gameState.highestBid : '-';
        document.getElementById('current-round').textContent = this.gameState.currentRound;
    }

    getTeamTricksDisplay() {
        if (!this.gameState.teams || Object.keys(this.gameState.teams).length === 0) {
            return '-';
        }
        
        // Calculate bidding team tricks
        let biddingTeamTricks = 0;
        let opponentTricks = 0;
        
        for (const [playerId, team] of Object.entries(this.gameState.teams)) {
            const tricks = this.gameState.tricksWon[parseInt(playerId)] || 0;
            if (team === 'bidder' || team === 'partner') {
                biddingTeamTricks += tricks;
            } else if (team === 'opponent') {
                opponentTricks += tricks;
            }
        }
        
        // Show format: "Budlag: X | Motstandere: Y" or just the relevant team for current player
        const myTeam = this.gameState.teams[this.playerId];
        
        if (myTeam === 'bidder' || myTeam === 'partner') {
            return `${biddingTeamTricks}/${this.gameState.highestBid || 0}`;
        } else if (myTeam === 'opponent') {
            return `${opponentTricks}`;
        } else {
            // No teams set yet
            return '-';
        }
    }

    updatePlayerHands() {
        // Update main player (current user)
        const mainPlayerSection = document.getElementById('main-player');
        const mainHandContainer = mainPlayerSection.querySelector('[data-player="main"]');
        const mainPlayerId = this.playerId;
        
        // Only rebuild hand if the number of cards changed
        const currentCardCount = mainHandContainer.children.length;
        const newCardCount = this.gameState.hands[mainPlayerId]?.length || 0;
        
        if (currentCardCount !== newCardCount) {
            mainHandContainer.innerHTML = '';
            
            // Display main player's cards
            if (this.gameState.hands[mainPlayerId]) {
                this.gameState.hands[mainPlayerId].forEach((card, index) => {
                    const cardElement = this.createCardElement(card, mainPlayerId);
                    cardElement.style.animationDelay = `${index * 0.05}s`;
                    mainHandContainer.appendChild(cardElement);
                });
            }
        } else {
            // Just update the playable state of existing cards
            const cardElements = mainHandContainer.querySelectorAll('.card');
            cardElements.forEach((cardElement, index) => {
                const card = this.gameState.hands[mainPlayerId][index];
                if (card) {
                    this.updateCardPlayableState(cardElement, card, mainPlayerId);
                }
            });
        }
        
        // Clear highlighting
        mainPlayerSection.classList.remove('current-player', 'current-bidder', 'team-bidder', 'team-partner', 'team-opponent');
        
        // Update main player name and apply highlighting
        const mainPlayerName = this.gameState.players[mainPlayerId]?.name || 'Du';
        mainPlayerSection.querySelector('.player-name').textContent = `${mainPlayerName} (Du)`;
        this.applyPlayerHighlighting(mainPlayerSection, mainPlayerId);
        
        // Update other players in turn order
        const otherPlayerOrder = this.getOtherPlayersInOrder();
        
        otherPlayerOrder.forEach((actualPlayerId, index) => {
            const otherPlayerSection = document.getElementById(`other-player-${index + 1}`);
            const handContainer = otherPlayerSection.querySelector(`[data-player="other-${index + 1}"]`);
            
            // Only rebuild if card count changed
            const currentOtherCardCount = handContainer.children.length;
            const newOtherCardCount = this.gameState.hands[actualPlayerId]?.length || 0;
            
            if (currentOtherCardCount !== newOtherCardCount) {
                handContainer.innerHTML = '';
                
                // Display cards (hidden for other players)
                if (this.gameState.hands[actualPlayerId]) {
                    this.gameState.hands[actualPlayerId].forEach((card, cardIndex) => {
                        const cardElement = this.createCardElement(card, actualPlayerId);
                        cardElement.style.animationDelay = `${cardIndex * 0.05}s`;
                        handContainer.appendChild(cardElement);
                    });
                }
            }
            
            // Clear highlighting and update player info
            otherPlayerSection.classList.remove('current-player', 'current-bidder', 'team-bidder', 'team-partner', 'team-opponent');
            
            const playerName = this.gameState.players[actualPlayerId]?.name || `Spiller ${actualPlayerId + 1}`;
            otherPlayerSection.querySelector('.player-name').textContent = playerName;
            
            // Apply highlighting
            this.applyPlayerHighlighting(otherPlayerSection, actualPlayerId);
            
            // Update stats
            const tricksSpan = otherPlayerSection.querySelector('.tricks');
            const scoreSpan = otherPlayerSection.querySelector('.score');
            tricksSpan.textContent = this.gameState.tricksWon[actualPlayerId] || 0;
            scoreSpan.textContent = this.gameState.scores[actualPlayerId] || 0;
        });
        
        // Update main player stats
        const mainTricksSpan = mainPlayerSection.querySelector('.tricks');
        const mainScoreSpan = mainPlayerSection.querySelector('.score');
        mainTricksSpan.textContent = this.gameState.tricksWon[mainPlayerId] || 0;
        mainScoreSpan.textContent = this.gameState.scores[mainPlayerId] || 0;
        
        // Update team indicators
        this.updateTeamIndicators();
    }

    updateCardPlayableState(cardElement, card, playerId) {
        // Remove existing classes
        cardElement.classList.remove('playable', 'forced');
        
        // Trump selection phase - bidder can play any card
        if (this.gameState.phase === 'trump_selection' && 
            playerId === this.gameState.highestBidder &&
            playerId === this.playerId) {
            cardElement.classList.add('playable');
        }
        // Regular playing phases - only if it's this player's turn
        else if ((this.gameState.phase === 'playing' || this.gameState.phase === 'partner_selection') && 
            this.gameState.currentPlayer === playerId &&
            playerId === this.playerId) {
            cardElement.classList.add('playable');
        }
        
        // Special highlighting for partner's requested card
        if (this.gameState.waitingForPartner && 
            playerId === this.gameState.partnerId && 
            this.gameState.trumpCardRequest &&
            card.suit === this.gameState.trumpCardRequest.suit && 
            card.rank === this.gameState.trumpCardRequest.rank) {
            cardElement.classList.add('forced');
        }
    }

    // Get other players in turn order
    getOtherPlayersInOrder() {
        const otherPlayers = [];
        
        // Start from the player after the main player and go in order
        for (let i = 1; i <= 3; i++) {
            const playerId = (this.playerId + i) % 4;
            otherPlayers.push(playerId);
        }
        
        return otherPlayers;
    }

    // Helper method for applying highlighting
    applyPlayerHighlighting(playerSection, playerId) {
        // Highlight current player or bidder based on phase
        if (this.gameState.phase === 'bidding' && this.gameState.currentBidder === playerId) {
            playerSection.classList.add('current-bidder');
        } else if ((this.gameState.phase === 'trump_selection' || this.gameState.phase === 'playing' || this.gameState.phase === 'partner_selection') && this.gameState.currentPlayer === playerId) {
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

    updateTeamIndicators() {
        // Update main player team indicator
        const mainIndicator = document.getElementById('team-indicator-main');
        const mainPlayerId = this.playerId;
        
        if (this.gameState.teams[mainPlayerId]) {
            mainIndicator.classList.remove('hidden');
            mainIndicator.classList.remove('bidder', 'partner', 'opponent');
            
            if (this.gameState.teams[mainPlayerId] === 'bidder') {
                mainIndicator.textContent = 'Budgiver';
                mainIndicator.classList.add('bidder');
            } else if (this.gameState.teams[mainPlayerId] === 'partner') {
                mainIndicator.textContent = 'Partner';
                mainIndicator.classList.add('partner');
            } else if (this.gameState.teams[mainPlayerId] === 'opponent') {
                mainIndicator.textContent = 'Motstander';
                mainIndicator.classList.add('opponent');
            }
        } else {
            mainIndicator.classList.add('hidden');
        }
        
        // Update other players team indicators
        const otherPlayerOrder = this.getOtherPlayersInOrder();
        
        otherPlayerOrder.forEach((actualPlayerId, index) => {
            const indicator = document.getElementById(`team-indicator-other-${index + 1}`);
            
            if (this.gameState.teams[actualPlayerId]) {
                indicator.classList.remove('hidden');
                indicator.classList.remove('bidder', 'partner', 'opponent');
                
                if (this.gameState.teams[actualPlayerId] === 'bidder') {
                    indicator.textContent = 'Budgiver';
                    indicator.classList.add('bidder');
                } else if (this.gameState.teams[actualPlayerId] === 'partner') {
                    indicator.textContent = 'Partner';
                    indicator.classList.add('partner');
                } else if (this.gameState.teams[actualPlayerId] === 'opponent') {
                    indicator.textContent = 'Motstander';
                    indicator.classList.add('opponent');
                }
            } else {
                indicator.classList.add('hidden');
            }
        });
    }

    updateControls() {
        console.log('Updating controls for phase:', this.gameState.phase);
        
        // Hide all controls
        document.getElementById('bidding-controls').classList.add('hidden');
        document.getElementById('partner-controls').classList.add('hidden');
        document.getElementById('round-end-controls').classList.add('hidden');

        if (this.gameState.phase === 'bidding') {
            console.log('Showing bidding controls');
            document.getElementById('bidding-controls').classList.remove('hidden');
            const currentBidderName = this.gameState.players[this.gameState.currentBidder]?.name || `Spiller ${this.gameState.currentBidder + 1}`;
            document.getElementById('current-bidder').textContent = currentBidderName;
            this.updateBidButtons();
        } else if (this.gameState.phase === 'trump_selection' && this.playerId === this.gameState.highestBidder) {
            console.log('Showing trump selection - player should play a card');
            // Show message that player should play a card to set trump
            this.showPopupMessage('Spill et kort for å sette trumf!');
        } else if (this.gameState.phase === 'partner_selection' && this.playerId === this.gameState.highestBidder) {
            console.log('Showing partner selection controls');
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
        
        console.log('Updating bid buttons - My turn:', isMyTurn, 'Pending:', hasPendingBid, 'Highest bid:', this.gameState.highestBid);
        
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
            
            const winnerName = this.gameState.trickWinner?.playerName || 
                  this.gameState.players[this.gameState.trickWinner?.playerId]?.name || 
                  `Spiller ${(this.gameState.trickWinner?.playerId || 0) + 1}`;
            winnerMessage.textContent = `${winnerName} vant stikket!`;
            
            // Add countdown timer
            const countdown = document.createElement('div');
            countdown.className = 'trick-countdown';
            countdown.textContent = '5';
            trickArea.appendChild(countdown);
            
            let timeLeft = 5;
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
            
            if (success) {
                resultText += `Maktet! (+${this.gameState.highestBid} poeng)`;
            } else {
                resultText += `Feilet! (-${this.gameState.highestBid} poeng)`;
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
        if (clickable && playerId === this.playerId) {
            // Trump selection phase - bidder can play any card to set trump
            if (this.gameState.phase === 'trump_selection' && 
                playerId === this.gameState.highestBidder) {
                cardDiv.classList.add('playable');
                cardDiv.addEventListener('click', () => {
                    this.socket.emit('playCard', {suit: card.suit, rank: card.rank});
                });
            }
            // Regular playing phase - only if it's player's turn
            else if ((this.gameState.phase === 'playing' || this.gameState.phase === 'partner_selection') && 
                playerId === this.gameState.currentPlayer) {
                cardDiv.classList.add('playable');
                cardDiv.addEventListener('click', () => {
                    this.socket.emit('playCard', {suit: card.suit, rank: card.rank});
                });
            }
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