class MultiplayerGameClient {
    constructor() {
        this.socket = io();
        this.gameState = null;
        this.playerId = null;
        this.lastStateSequence = -1; // Track state updates
        this.pendingActions = new Set(); // Track pending actions
        this.existingCards = new Map(); // Track existing cards to prevent redraw
        
        this.initializeFromStorage();
        this.setupSocketListeners();
        this.setupEventListeners();
        this.createTeamTricksDisplay();
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

    createTeamTricksDisplay() {
        // Create team tricks display element
        const teamDisplay = document.createElement('div');
        teamDisplay.id = 'team-tricks-display';
        teamDisplay.className = 'team-tricks-display hidden';
        teamDisplay.innerHTML = `
            <div class="team-tricks-row">
                <span>Budgivere:</span>
                <span class="team-bidder-tricks" id="bidder-tricks">0</span>
            </div>
            <div class="team-tricks-row">
                <span>Motstandere:</span>
                <span class="team-opponent-tricks" id="opponent-tricks">0</span>
            </div>
        `;
        document.body.appendChild(teamDisplay);
    }

    // Method to arrange players in play order
    arrangePlayersInOrder() {
        if (!this.gameState || this.playerId === null) return;

        // Calculate the play order starting from current player
        const playOrder = [];
        for (let i = 1; i <= 3; i++) {
            playOrder.push((this.playerId + i) % 4);
        }

        // Update player sections with correct data
        playOrder.forEach((playerId, index) => {
            const playerSection = document.getElementById(`next-player-${index + 1}`);
            const player = this.gameState.players[playerId];
            
            if (player && playerSection) {
                // Update player name
                const nameElement = playerSection.querySelector('.player-name');
                nameElement.textContent = player.name;
                
                // Update stats
                const tricksElement = playerSection.querySelector('.tricks');
                const scoreElement = playerSection.querySelector('.score');
                tricksElement.textContent = this.gameState.tricksWon[playerId] || 0;
                scoreElement.textContent = this.gameState.scores[playerId] || 0;
                
                // Update card count
                const cardCountElement = playerSection.querySelector('.card-count-display');
                const cardCount = this.gameState.hands[playerId] ? this.gameState.hands[playerId].length : 13;
                cardCountElement.textContent = cardCount;
                
                // Store player ID for reference
                playerSection.dataset.playerId = playerId;
                
                // Update team styling and highlighting
                this.updatePlayerSectionStyling(playerSection, playerId);
            }
        });

        // Update your own section
        this.updateMyPlayerSection();
    }

    updatePlayerSectionStyling(playerSection, playerId) {
        // Clear existing classes
        playerSection.classList.remove('current-player', 'current-bidder', 'team-bidder', 'team-partner', 'team-opponent');
        
        // Add current player/bidder highlighting
        if (this.gameState.phase === 'bidding' && this.gameState.currentBidder === playerId) {
            playerSection.classList.add('current-bidder');
        } else if ((this.gameState.phase === 'playing' || this.gameState.phase === 'partner_selection') && this.gameState.currentPlayer === playerId) {
            playerSection.classList.add('current-player');
        }
        
        // Add team styling
        const teamIndicator = playerSection.querySelector('.team-indicator');
        if (this.gameState.teams[playerId]) {
            teamIndicator.classList.remove('hidden');
            teamIndicator.classList.remove('bidder', 'partner', 'opponent');
            
            if (this.gameState.teams[playerId] === 'bidder') {
                teamIndicator.textContent = 'Budgiver';
                teamIndicator.classList.add('bidder');
                playerSection.classList.add('team-bidder');
            } else if (this.gameState.teams[playerId] === 'partner') {
                teamIndicator.textContent = 'Partner';
                teamIndicator.classList.add('partner');
                playerSection.classList.add('team-partner');
            } else if (this.gameState.teams[playerId] === 'opponent') {
                teamIndicator.textContent = 'Motstander';
                teamIndicator.classList.add('opponent');
                playerSection.classList.add('team-opponent');
            }
        } else {
            teamIndicator.classList.add('hidden');
        }
    }

    updateMyPlayerSection() {
        const mySection = document.getElementById('my-player-section');
        const myHandContainer = document.getElementById('my-hand-cards');
        
        if (!mySection || this.playerId === null) return;
        
        // Update my player name and stats
        const nameElement = mySection.querySelector('.player-name');
        const tricksElement = mySection.querySelector('.tricks');
        const scoreElement = mySection.querySelector('.score');
        
        const myPlayer = this.gameState.players[this.playerId];
        if (myPlayer) {
            nameElement.textContent = `${myPlayer.name} (Du)`;
        }
        
        tricksElement.textContent = this.gameState.tricksWon[this.playerId] || 0;
        scoreElement.textContent = this.gameState.scores[this.playerId] || 0;
        
        // Update my cards
        if (this.gameState.hands[this.playerId]) {
            this.updatePlayerCards(this.playerId, myHandContainer, this.gameState.hands[this.playerId]);
        }
        
        // Update team styling for my section
        const myTeamIndicator = document.getElementById('my-team-indicator');
        mySection.classList.remove('current-player', 'current-bidder', 'team-bidder', 'team-partner', 'team-opponent');
        
        // Add current player/bidder highlighting
        if (this.gameState.phase === 'bidding' && this.gameState.currentBidder === this.playerId) {
            mySection.classList.add('current-bidder');
        } else if ((this.gameState.phase === 'playing' || this.gameState.phase === 'partner_selection') && this.gameState.currentPlayer === this.playerId) {
            mySection.classList.add('current-player');
        }
        
        // Add team styling
        if (this.gameState.teams[this.playerId]) {
            myTeamIndicator.classList.remove('hidden');
            myTeamIndicator.classList.remove('bidder', 'partner', 'opponent');
            
            if (this.gameState.teams[this.playerId] === 'bidder') {
                myTeamIndicator.textContent = 'Budgiver';
                myTeamIndicator.classList.add('bidder');
                mySection.classList.add('team-bidder');
            } else if (this.gameState.teams[this.playerId] === 'partner') {
                myTeamIndicator.textContent = 'Partner';
                myTeamIndicator.classList.add('partner');
                mySection.classList.add('team-partner');
            } else if (this.gameState.teams[this.playerId] === 'opponent') {
                myTeamIndicator.textContent = 'Motstander';
                myTeamIndicator.classList.add('opponent');
                mySection.classList.add('team-opponent');
            }
        } else {
            myTeamIndicator.classList.add('hidden');
        }
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
        this.updateTeamTricksDisplay();
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

    updateTeamTricksDisplay() {
        const teamDisplay = document.getElementById('team-tricks-display');
        const bidderTricks = document.getElementById('bidder-tricks');
        const opponentTricks = document.getElementById('opponent-tricks');
        
        if (this.gameState.teams && Object.keys(this.gameState.teams).length > 0) {
            teamDisplay.classList.remove('hidden');
            
            if (this.gameState.teamTricks) {
                bidderTricks.textContent = this.gameState.teamTricks.bidder || 0;
                opponentTricks.textContent = this.gameState.teamTricks.opponent || 0;
            } else {
                bidderTricks.textContent = '0';
                opponentTricks.textContent = '0';
            }
        } else {
            teamDisplay.classList.add('hidden');
        }
    }

    updatePlayerHands() {
        // Use the new layout system
        this.arrangePlayersInOrder();
    }

    // NEW METHOD: Smarter card updating to prevent unnecessary redraws
    updatePlayerCards(playerId, container, newCards) {
        const existingKey = `player_${playerId}`;
        const newCardsKey = JSON.stringify(newCards.map(c => ({suit: c.suit, rank: c.rank, hidden: c.hidden})));
        
        // Only redraw if cards actually changed
        if (this.existingCards.get(existingKey) !== newCardsKey) {
            // Clear container and redraw
            container.innerHTML = '';
            
            newCards.forEach((card, index) => {
                const cardElement = this.createCardElement(card, playerId);
                container.appendChild(cardElement);
            });
            
            // Update cache
            this.existingCards.set(existingKey, newCardsKey);
        } else {
            // Cards haven't changed, just update playability
            const existingCardElements = container.querySelectorAll('.card');
            existingCardElements.forEach((cardElement, index) => {
                if (index < newCards.length) {
                    const card = newCards[index];
                    this.updateCardPlayability(cardElement, card, playerId);
                }
            });
        }
    }

    // NEW METHOD: Update card playability without redrawing
    updateCardPlayability(cardElement, card, playerId) {
        // Remove existing playability classes
        cardElement.classList.remove('playable', 'forced');
        
        if (!card.hidden) {
            // Only make cards clickable if it's this player's turn and they own the card
            if ((this.gameState.phase === 'playing' || this.gameState.phase === 'partner_selection') && 
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

        // Create card elements for each rank in the trump suit that bidder doesn't have
        const ranks = [14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2];
        const rankNames = {14: 'A', 13: 'K', 12: 'Q', 11: 'J'};

        ranks.forEach(rank => {
            // Only show cards the bidder doesn't have
            if (!bidderTrumpRanks.has(rank)) {
                const cardButton = document.createElement('div');
                cardButton.className = `partner-card-btn ${this.gameState.trumpSuit}`;
                cardButton.dataset.rank = rank;
                cardButton.dataset.suit = this.gameState.trumpSuit;
                
                const rankDisplay = rankNames[rank] || rank.toString();
                const suitSymbol = this.getSuitSymbol(this.gameState.trumpSuit);
                
                // Create card structure similar to regular cards
                cardButton.innerHTML = `
                    <div class="card-rank">${rankDisplay}</div>
                    <div class="card-suit">${suitSymbol}</div>
                `;
                
                cardButton.addEventListener('click', () => {
                    // Clear previous selection
                    document.querySelectorAll('.partner-card-btn').forEach(b => b.classList.remove('selected'));
                    cardButton.classList.add('selected');
                    this.selectedPartnerCard = {suit: this.gameState.trumpSuit, rank: rank};
                    document.getElementById('confirm-partner').classList.remove('hidden');
                });
                
                container.appendChild(cardButton);
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

    updatePlayerStats() {
        // Stats are now updated through arrangePlayersInOrder() and updateMyPlayerSection()
        // This method is kept for compatibility but doesn't need to do anything specific
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
        
        // Handle hidden cards (other players' cards) - show card backs
        if (card.hidden) {
            cardDiv.className = 'card hidden';
            // Add the card back content that CSS expects
            cardDiv.innerHTML = `
                <div class="card-rank" style="display: none;"></div>
                <div class="card-suit" style="display: none;"></div>
            `;
            // The CSS ::before pseudo-element will handle the card back symbol
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