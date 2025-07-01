class LobbyManager {
    constructor() {
        this.socket = io();
        this.currentGameCode = null;
        this.playerId = null;
        this.playerName = null;
        
        this.initializeElements();
        this.setupEventListeners();
        this.setupSocketListeners();
    }

    initializeElements() {
        // Forms
        this.initialForm = document.getElementById('initial-form');
        this.joinForm = document.getElementById('join-form');
        this.lobby = document.getElementById('lobby');
        
        // Inputs
        this.playerNameInput = document.getElementById('player-name');
        this.gameCodeInput = document.getElementById('game-code');
        
        // Buttons
        this.createGameBtn = document.getElementById('create-game');
        this.joinGameBtn = document.getElementById('join-game');
        this.joinGameSubmitBtn = document.getElementById('join-game-btn');
        this.backBtn = document.getElementById('back-btn');
        this.startGameBtn = document.getElementById('start-game-btn');
        this.leaveGameBtn = document.getElementById('leave-game');
        
        // Display elements
        this.currentGameCodeSpan = document.getElementById('current-game-code');
        this.playerCountSpan = document.getElementById('player-count');
        this.playersContainer = document.getElementById('players-container');
        this.messageDiv = document.getElementById('message');
    }

    setupEventListeners() {
        // Create game
        this.createGameBtn.addEventListener('click', () => {
            const name = this.playerNameInput.value.trim();
            if (!name) {
                this.showMessage('Vennligst skriv inn navnet ditt', 'error');
                return;
            }
            
            this.playerName = name;
            this.socket.emit('createGame', name);
            this.createGameBtn.classList.add('loading');
        });

        // Show join form
        this.joinGameBtn.addEventListener('click', () => {
            const name = this.playerNameInput.value.trim();
            if (!name) {
                this.showMessage('Vennligst skriv inn navnet ditt', 'error');
                return;
            }
            
            this.playerName = name;
            this.showView('join');
        });

        // Join game
        this.joinGameSubmitBtn.addEventListener('click', () => {
            const gameCode = this.gameCodeInput.value.trim().toUpperCase();
            if (!gameCode) {
                this.showMessage('Vennligst skriv inn spillkode', 'error');
                return;
            }
            
            this.socket.emit('joinGame', {gameCode, playerName: this.playerName});
            this.joinGameSubmitBtn.classList.add('loading');
        });

        // Back to main form
        this.backBtn.addEventListener('click', () => {
            this.showView('initial');
        });

        // Start game
        this.startGameBtn.addEventListener('click', () => {
            this.socket.emit('startGame');
            this.startGameBtn.classList.add('loading');
            this.startGameBtn.textContent = 'Starter spill...';
        });

        // Leave game
        this.leaveGameBtn.addEventListener('click', () => {
            this.leaveGame();
        });

        // Enter key handlers
        this.playerNameInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.createGameBtn.click();
            }
        });

        this.gameCodeInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.joinGameSubmitBtn.click();
            }
        });

        // Auto-uppercase game code input
        this.gameCodeInput.addEventListener('input', (e) => {
            e.target.value = e.target.value.toUpperCase();
        });
    }

    setupSocketListeners() {
        this.socket.on('gameCreated', (data) => {
            this.currentGameCode = data.gameCode;
            this.playerId = data.playerId;
            this.currentGameCodeSpan.textContent = data.gameCode;
            this.showView('lobby');
            this.showMessage('Spill opprettet! Del koden med andre spillere.', 'success');
            this.createGameBtn.classList.remove('loading');
        });

        this.socket.on('gameJoined', (data) => {
            this.currentGameCode = data.gameCode;
            this.playerId = data.playerId;
            this.currentGameCodeSpan.textContent = data.gameCode;
            this.showView('lobby');
            this.showMessage('Ble med i spillet!', 'success');
            this.joinGameSubmitBtn.classList.remove('loading');
        });

        this.socket.on('lobbyUpdated', (data) => {
            this.updateLobby(data);
        });

        this.socket.on('gameStarted', (gameState) => {
            console.log('Game started, received game state:', gameState);
            // Store game state and player info more reliably
            const gameData = {
                ...gameState,
                gameCode: this.currentGameCode,
                playerId: this.playerId
            };
            
            localStorage.setItem('gameState', JSON.stringify(gameData));
            localStorage.setItem('playerInfo', JSON.stringify({
                gameCode: this.currentGameCode,
                playerId: this.playerId,
                playerName: this.playerName
            }));
            
            // Small delay to ensure data is stored
            setTimeout(() => {
                window.location.href = 'game.html';
            }, 100);
        });

        this.socket.on('error', (message) => {
            this.showMessage(message, 'error');
            this.createGameBtn.classList.remove('loading');
            this.joinGameSubmitBtn.classList.remove('loading');
            this.startGameBtn.classList.remove('loading');
            this.startGameBtn.textContent = 'Start spill';
        });

        this.socket.on('playerDisconnected', (playerId) => {
            this.showMessage(`Spiller ${playerId + 1} koblet fra`, 'info');
        });

        this.socket.on('disconnect', () => {
            this.showMessage('Mistet tilkobling til server', 'error');
        });

        this.socket.on('connect', () => {
            if (this.currentGameCode) {
                this.showMessage('Tilkoblet igjen', 'success');
            }
        });
    }

    showView(view) {
        // Hide all views
        this.initialForm.classList.add('hidden');
        this.joinForm.classList.add('hidden');
        this.lobby.classList.add('hidden');
        
        // Show selected view
        switch (view) {
            case 'initial':
                this.initialForm.classList.remove('hidden');
                break;
            case 'join':
                this.joinForm.classList.remove('hidden');
                this.gameCodeInput.focus();
                break;
            case 'lobby':
                this.lobby.classList.remove('hidden');
                break;
        }
    }

    updateLobby(data) {
        // Update player count
        this.playerCountSpan.textContent = data.players.length;
        
        // Update players list
        this.playersContainer.innerHTML = '';
        data.players.forEach((player, index) => {
            const playerDiv = document.createElement('div');
            playerDiv.className = 'player-item';
            
            const playerNameDiv = document.createElement('div');
            playerNameDiv.className = 'player-name';
            playerNameDiv.textContent = player.name;
            
            const playerStatusDiv = document.createElement('div');
            playerStatusDiv.className = 'player-status';
            
            if (player.id === this.playerId) {
                playerStatusDiv.textContent = 'Du';
                playerDiv.style.borderLeftColor = '#FF9800';
            } else {
                playerStatusDiv.textContent = 'Klar';
            }
            
            playerDiv.appendChild(playerNameDiv);
            playerDiv.appendChild(playerStatusDiv);
            this.playersContainer.appendChild(playerDiv);
        });
        
        // Update start button
        if (data.canStart) {
            this.startGameBtn.disabled = false;
            this.startGameBtn.textContent = 'Start spill';
            
            if (data.players.length === 4) {
                this.startGameBtn.classList.add('pulse');
                this.showMessage('Alle spillere er klare! Du kan starte spillet.', 'success');
            }
        } else {
            this.startGameBtn.disabled = true;
            this.startGameBtn.classList.remove('pulse');
            
            const playersNeeded = 4 - data.players.length;
            this.startGameBtn.textContent = `Venter på ${playersNeeded} spiller${playersNeeded > 1 ? 'e' : ''}`;
        }
    }

    leaveGame() {
        this.socket.disconnect();
        this.socket.connect();
        this.currentGameCode = null;
        this.playerId = null;
        this.playerName = null;
        this.playerNameInput.value = '';
        this.gameCodeInput.value = '';
        this.showView('initial');
        this.showMessage('Forlot spillet', 'info');
    }

    showMessage(text, type = 'info') {
        this.messageDiv.textContent = text;
        this.messageDiv.className = `message ${type}`;
        this.messageDiv.classList.remove('hidden');
        
        // Auto-hide after 5 seconds
        setTimeout(() => {
            this.messageDiv.classList.add('hidden');
        }, 5000);
    }
}

// Initialize lobby manager when page loads
document.addEventListener('DOMContentLoaded', () => {
    new LobbyManager();
});