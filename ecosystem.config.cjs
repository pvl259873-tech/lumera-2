module.exports = {
  apps: [
    {
      name: 'lumera-dashboard',
      script: './server.js',
      autorestart: true,
      restart_delay: 3000,
      max_restarts: 10,
      env: { NODE_ENV: 'production' },
    },
    {
      name: 'lumera-bot',
      script: './src/bot.js',
      autorestart: true,
      restart_delay: 3000,
      max_restarts: 10,
      env: { NODE_ENV: 'production' },
    },
  ],
};