const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Состояние игры
let gameState = {
  status: 'waiting', // waiting, countdown, running, crashed
  countdown: 10,
  multiplier: 1.00,
  crashAt: 0,
  bets: [],
  history: []
};

// Генерация точки краша (провабли честный)
function generateCrashPoint() {
  const e = Math.random();
  if (e < 0.01) return 1.00; // 1% мгновенный краш
  return Math.floor((1 / (1 - e)) * 100) / 100;
}

// Запуск нового раунда
function startNewRound() {
  gameState.status = 'countdown';
  gameState.countdown = 10;
  gameState.multiplier = 1.00;
  gameState.crashAt = generateCrashPoint();
  gameState.bets = [];
  
  console.log(`Новый раунд! Краш на: ${gameState.crashAt}x`);
  
  io.emit('gameState', {
    status: 'countdown',
    countdown: gameState.countdown,
    multiplier: 1.00,
    bets: gameState.bets,
    history: gameState.history.slice(-20)
  });
  
  // Обратный отсчёт
  const countdownInterval = setInterval(() => {
    gameState.countdown--;
    
    io.emit('countdown', gameState.countdown);
    
    if (gameState.countdown <= 0) {
      clearInterval(countdownInterval);
      startGame();
    }
  }, 1000);
}

// Запуск игры (множитель растёт)
function startGame() {
  gameState.status = 'running';
  gameState.multiplier = 1.00;
  
  io.emit('gameStart', {
    status: 'running',
    multiplier: gameState.multiplier,
    bets: gameState.bets
  });
  
  // Множитель растёт
  const gameInterval = setInterval(() => {
    if (gameState.status !== 'running') {
      clearInterval(gameInterval);
      return;
    }
    
    // Рост множителя
    gameState.multiplier += 0.01;
    gameState.multiplier = Math.round(gameState.multiplier * 100) / 100;
    
    // Обновляем суммы у всех игроков
    gameState.bets.forEach(bet => {
      if (bet.status === 'active') {
        bet.currentSum = Math.floor(bet.amount * gameState.multiplier);
      }
    });
    
    io.emit('multiplierUpdate', {
      multiplier: gameState.multiplier,
      bets: gameState.bets
    });
    
    // Проверка краша
    if (gameState.multiplier >= gameState.crashAt) {
      clearInterval(gameInterval);
      crashGame();
    }
  }, 100);
}

// Краш!
function crashGame() {
  gameState.status = 'crashed';
  
  // Все активные ставки проиграли
  gameState.bets.forEach(bet => {
    if (bet.status === 'active') {
      bet.status = 'lost';
    }
  });
  
  // Добавляем в историю
  gameState.history.unshift({
    multiplier: gameState.crashAt.toFixed(2) + 'x',
    timestamp: Date.now()
  });
  
  // Ограничиваем историю до 50 записей
  if (gameState.history.length > 50) {
    gameState.history = gameState.history.slice(0, 50);
  }
  
  console.log(`КРАШ на ${gameState.crashAt}x!`);
  
  io.emit('crash', {
    crashAt: gameState.crashAt,
    bets: gameState.bets,
    history: gameState.history.slice(-20)
  });
  
  // Новый раунд через 5 секунд
  setTimeout(() => {
    startNewRound();
  }, 5000);
}

// Подключение клиента
io.on('connection', (socket) => {
  console.log(`Игрок подключился: ${socket.id}`);
  
  // Отправляем текущее состояние
  socket.emit('gameState', {
    status: gameState.status,
    countdown: gameState.countdown,
    multiplier: gameState.multiplier,
    bets: gameState.bets,
    history: gameState.history.slice(-20)
  });
  
  // Игрок делает ставку
  socket.on('placeBet', (data) => {
    if (gameState.status !== 'countdown' && gameState.status !== 'waiting') {
      socket.emit('error', { message: 'Ставки принимаются только во время ожидания!' });
      return;
    }
    
    // Проверяем что игрок ещё не ставил
    const existingBet = gameState.bets.find(b => b.oderId === data.oderId);
    if (existingBet) {
      socket.emit('error', { message: 'Вы уже сделали ставку!' });
      return;
    }
    
    const bet = {
      oderId: data.oderId,
      odername: data.odername || 'Аноним',
      avatar: data.avatar || '',
      amount: data.amount,
      currentSum: data.amount,
      multiplier: 1.00,
      status: 'active',
      socketId: socket.id
    };
    
    gameState.bets.push(bet);
    
    console.log(`Ставка: ${bet.odername} - ${bet.amount} ⭐`);
    
    // Уведомляем всех о новой ставке
    io.emit('newBet', {
      bets: gameState.bets
    });
    
    socket.emit('betPlaced', { success: true, bet });
  });
  
  // Игрок забирает выигрыш
  socket.on('cashOut', (data) => {
    if (gameState.status !== 'running') {
      socket.emit('error', { message: 'Игра не запущена!' });
      return;
    }
    
    const bet = gameState.bets.find(b => b.oderId === data.oderId && b.status === 'active');
    if (!bet) {
      socket.emit('error', { message: 'Ставка не найдена!' });
      return;
    }
    
    bet.status = 'won';
    bet.cashoutMultiplier = gameState.multiplier;
    bet.winAmount = Math.floor(bet.amount * gameState.multiplier);
    
    console.log(`Кэшаут: ${bet.odername} забрал ${bet.winAmount} ⭐ (${gameState.multiplier}x)`);
    
    io.emit('playerCashout', {
      oderId: data.oderId,
      winAmount: bet.winAmount,
      multiplier: gameState.multiplier,
      bets: gameState.bets
    });
    
    socket.emit('cashoutSuccess', {
      winAmount: bet.winAmount,
      multiplier: gameState.multiplier
    });
  });
  
  // Отключение
  socket.on('disconnect', () => {
    console.log(`Игрок отключился: ${socket.id}`);
  });
});

// Запуск сервера
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`🚀 Сервер запущен на порту ${PORT}`);
  
  // Запускаем первый раунд через 3 секунды
  setTimeout(() => {
    startNewRound();
  }, 3000);
});

// Health check
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    gameState: {
      status: gameState.status,
      players: gameState.bets.length,
      multiplier: gameState.multiplier
    }
  });
});
